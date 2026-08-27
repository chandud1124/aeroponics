import * as crypto from "crypto";

// Cache discovered endpoints to make PTZ commands instant
type PtzEndpoints = {
  mediaUrl: string;
  ptzUrl: string;
  profileToken: string;
};
const ptzCache = new Map<string, PtzEndpoints>();

function generateOnvifAuth(password: string) {
  const nonceBuffer = crypto.randomBytes(20);
  const nonceBase64 = nonceBuffer.toString("base64");
  const created = new Date().toISOString().split(".")[0] + "Z";
  
  const sha1 = crypto.createHash("sha1");
  sha1.update(Buffer.concat([
    nonceBuffer,
    Buffer.from(created, "utf8"),
    Buffer.from(password, "utf8")
  ]));
  const digest = sha1.digest("base64");

  return {
    nonce: nonceBase64,
    created,
    digest
  };
}

function getSoapHeader(password?: string) {
  if (!password) return "";
  const auth = generateOnvifAuth(password);
  return `
    <soap:Header>
      <Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:s="http://www.w3.org/2003/05/soap-envelope">
        <UsernameToken>
          <Username>admin</Username>
          <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${auth.digest}</Password>
          <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${auth.nonce}</Nonce>
          <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${auth.created}</Created>
        </UsernameToken>
      </Security>
    </soap:Header>
  `;
}

const getCapabilitiesSoap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <soap:Header/>
  <soap:Body>
    <tds:GetCapabilities>
      <tds:Category>All</tds:Category>
    </tds:GetCapabilities>
  </soap:Body>
</soap:Envelope>`;

const getProfilesSoap = (header: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  ${header}
  <soap:Body>
    <trt:GetProfiles/>
  </soap:Body>
</soap:Envelope>`;

const getContinuousMoveSoap = (header: string, profileToken: string, x: number, y: number, z: number) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  ${header}
  <soap:Body>
    <tptz:ContinuousMove>
      <tptz:ProfileToken>${profileToken}</tptz:ProfileToken>
      <tptz:Velocity>
        <tt:PanTilt x="${x}" y="${y}"/>
        ${z !== 0 ? `<tt:Zoom x="${z}"/>` : ""}
      </tptz:Velocity>
    </tptz:ContinuousMove>
  </soap:Body>
</soap:Envelope>`;

const getStopSoap = (header: string, profileToken: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl">
  ${header}
  <soap:Body>
    <tptz:Stop>
      <tptz:ProfileToken>${profileToken}</tptz:ProfileToken>
      <tptz:PanTilt>true</tptz:PanTilt>
      <tptz:Zoom>true</tptz:Zoom>
    </tptz:Stop>
  </soap:Body>
</soap:Envelope>`;

function replaceXAddrHost(xaddr: string, ip: string, port: number) {
  try {
    const url = new URL(xaddr);
    url.hostname = ip;
    url.port = port.toString();
    return url.toString();
  } catch (e) {
    return xaddr;
  }
}

async function discoverPtz(ip: string, passcode: string): Promise<PtzEndpoints> {
  const cacheKey = `${ip}:${passcode}`;
  if (ptzCache.has(cacheKey)) {
    return ptzCache.get(cacheKey)!;
  }

  const ports = [80, 8000, 8899, 8080];
  let lastError = new Error("No ONVIF services detected on camera");

  for (const port of ports) {
    const url = `http://${ip}:${port}/onvif/device_service`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8"
        },
        body: getCapabilitiesSoap,
        signal: AbortSignal.timeout(2000)
      });

      if (!res.ok) continue;

      const xml = await res.text();
      const mediaMatch = xml.match(/<[^:]*:?Media>[^]*?<[^:]*:?XAddr>([^<]+)/);
      const ptzMatch = xml.match(/<[^:]*:?PTZ>[^]*?<[^:]*:?XAddr>([^<]+)/);

      if (mediaMatch && ptzMatch) {
        const mediaUrl = replaceXAddrHost(mediaMatch[1].trim(), ip, port);
        const ptzUrl = replaceXAddrHost(ptzMatch[1].trim(), ip, port);

        // Fetch Profiles
        const header = getSoapHeader(passcode);
        const profRes = await fetch(mediaUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/soap+xml; charset=utf-8"
          },
          body: getProfilesSoap(header),
          signal: AbortSignal.timeout(2000)
        });

        if (profRes.ok) {
          const profXml = await profRes.text();
          const tokenMatch = profXml.match(/<[^:]*:?Profiles[^>]*?token="([^"]+)"/);
          const profileToken = tokenMatch ? tokenMatch[1] : "Profile_1";

          const result = { mediaUrl, ptzUrl, profileToken };
          ptzCache.set(cacheKey, result);
          return result;
        }
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError;
}

export async function sendPtzCommand(ip: string, passcode: string, action: string) {
  const endpoints = await discoverPtz(ip, passcode);
  const header = getSoapHeader(passcode);

  let xml = "";
  if (action === "stop") {
    xml = getStopSoap(header, endpoints.profileToken);
  } else {
    let x = 0;
    let y = 0;
    let z = 0;

    switch (action) {
      case "up":    y = 0.6; break;
      case "down":  y = -0.6; break;
      case "left":  x = -0.6; break;
      case "right": x = 0.6; break;
      case "zoom_in":  z = 0.5; break;
      case "zoom_out": z = -0.5; break;
      default:
        throw new Error(`Unsupported PTZ action: ${action}`);
    }

    xml = getContinuousMoveSoap(header, endpoints.profileToken, x, y, z);
  }

  const res = await fetch(endpoints.ptzUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/soap+xml; charset=utf-8"
    },
    body: xml,
    signal: AbortSignal.timeout(3000)
  });

  if (!res.ok) {
    throw new Error(`PTZ command failed with HTTP code: ${res.status}`);
  }

  return true;
}
