import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const gpio = [
  ["GPIO 16", "DHT22 data", "Humidity sensor signal (INDOOR build)."],
  ["GPIO 36", "LDR analog input", "Ambient light reading for light automation."],
  ["GPIO 19", "Motor override button", "INPUT_PULLUP switch to GND; debounced in firmware."],
  ["GPIO 23", "Light override button", "INPUT_PULLUP switch to GND; debounced in firmware."],
  ["GPIO 27", "Relay IN - pump", "Active LOW on most modules. Drive OFF at boot."],
  ["GPIO 33", "Relay IN - grow light", "Active LOW on most modules."],
  ["GPIO 26", "Relay IN - battery charging", "Time-window controlled in firmware."],
  ["3.3V", "DHT22 power", "Power sensor from clean 3.3V rail."],
  ["GND", "Common ground", "Shared ground for ESP32 and sensors."],
];

const components = [
  ["ESP32 DevKit V1", "Main controller"],
  ["DHT22", "Humidity sensor"],
  ["LDR + resistor", "Ambient light sensing"],
  ["Relay module", "Pump / light / charge relay control"],
  ["Submersible pump", "Water circulation"],
  ["IP65 enclosure", "Outdoor-safe electronics housing"],
];

export function Documentation() {
  return (
    <div className="space-y-4">
      <Accordion type="multiple" defaultValue={["stack", "gpio"]} className="w-full">
        <AccordionItem value="stack">
          <AccordionTrigger>Active sensor stack</AccordionTrigger>
          <AccordionContent>
            <Card className="space-y-3 p-4 text-sm">
              <p>
                This build uses only two sensors in production:
                <strong> DHT22 (humidity)</strong> and <strong>LDR (ambient light)</strong>.
              </p>
              <p>
                Flow sensor, water-level probes, and DS18B20 temperature probes are intentionally not part of
                this firmware/UI build.
              </p>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="gpio">
          <AccordionTrigger>ESP32 GPIO mapping (current build)</AccordionTrigger>
          <AccordionContent>
            <Card className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">GPIO</th>
                    <th className="px-3 py-2 text-left">Connected to</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {gpio.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="px-3 py-2 font-mono">{row[0]}</td>
                      <td className="px-3 py-2">{row[1]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row[2]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="controls">
          <AccordionTrigger>Control behavior</AccordionTrigger>
          <AccordionContent>
            <Card className="space-y-2 p-4 text-sm text-muted-foreground">
              <p>1. Pump scheduling runs from backend plan.</p>
              <p>2. Light relay follows the configured time window and manual mode.</p>
              <p>3. Battery charger can be switched on or off in manual mode.</p>
              <p>4. Humidity is monitored and published to dashboard telemetry.</p>
              <p>5. Manual override buttons can force pump and light modes.</p>
            </Card>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="parts">
          <AccordionTrigger>Recommended parts</AccordionTrigger>
          <AccordionContent>
            <Card className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Part</th>
                    <th className="px-3 py-2 text-left">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{row[0]}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
