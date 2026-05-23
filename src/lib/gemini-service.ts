import type { LiveStatus, SensorSnapshot } from "./tower-storage";
import { error as logError, warn as logWarn, info as logInfo } from "./logger";
import { getReadings, initializeTowerStore } from "./tower-server-store";
import { luxToPar, DEFAULT_PAR_FACTOR } from "./light-utils";

interface GeminiAnalysisResponse {
  insights: string;
  recommendations: string[];
  healthScore: number;
  riskFactors: string[];
}

interface CachedAnalysis {
  response: GeminiAnalysisResponse;
  timestamp: number;
  dataHash: string;
}

// Cache with 45-minute TTL
const CACHE_TTL_MS = 45 * 60 * 1000;
let cachedAnalysis: CachedAnalysis | null = null;

/**
 * Computes a hash of sensor data to detect significant changes
 */
function computeDataHash(status: LiveStatus, history: SensorSnapshot[]): string {
  // Include basic status, ambient light, and recent manual reading counts/averages
  const readings = getReadings();
  const phAvg = readings.filter((r) => r.ph != null).map((r) => r.ph as number);
  const tdsAvg = readings.filter((r) => r.tds != null).map((r) => r.tds as number);
  const ecAvg = readings.filter((r) => r.ec != null).map((r) => r.ec as number);
  const ph = phAvg.length ? (phAvg.reduce((s, v) => s + v, 0) / phAvg.length).toFixed(2) : "N/A";
  const tds = tdsAvg.length ? (tdsAvg.reduce((s, v) => s + v, 0) / tdsAvg.length).toFixed(1) : "N/A";
  const ec = ecAvg.length ? (ecAvg.reduce((s, v) => s + v, 0) / ecAvg.length).toFixed(2) : "N/A";

  const key = `${status.humidityPct}|${status.lightLux ?? "N/A"}|${history.length}|${ph}|${tds}|${ec}`;
  // Simple hash: sum of char codes (good enough for cache invalidation)
  return String(Array.from(key).reduce((sum, c) => sum + c.charCodeAt(0), 0));
}

/**
 * Analyzes sensor data using Google's Gemini API
 * Requires GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable to be set
 * Results are cached for 45 minutes to reduce API calls and costs
 */
export async function analyzeSensorDataWithGemini(
  currentStatus: LiveStatus,
  sensorHistory: SensorSnapshot[],
  days: number = 7
): Promise<GeminiAnalysisResponse | null> {
  await initializeTowerStore();

  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;

  if (!apiKey) {
    logWarn("Google AI API key not configured");
    return null;
  }

  // Check cache: if TTL valid and data hasn't changed significantly, return cached result
  const dataHash = computeDataHash(currentStatus, sensorHistory);
  const now = Date.now();
  if (cachedAnalysis && now - cachedAnalysis.timestamp < CACHE_TTL_MS && cachedAnalysis.dataHash === dataHash) {
    const cacheAge = Math.round((now - cachedAnalysis.timestamp) / 1000);
    logInfo("Returning cached Gemini analysis", { cacheAgeSec: cacheAge });
    return cachedAnalysis.response;
  }

  try {
    // Prepare sensor data summary
    const humidities = sensorHistory.map((s) => s.humidityPct).filter((h) => h != null) as number[];
    const lightLuxValues = sensorHistory.map((s) => s.lightLux).filter((l) => l != null) as number[];

    const avgHumidity = humidities.length > 0 ? (humidities.reduce((a, b) => a + b, 0) / humidities.length).toFixed(1) : "N/A";
    const avgLightLux = lightLuxValues.length > 0 ? Math.round(lightLuxValues.reduce((a, b) => a + b, 0) / lightLuxValues.length) : null;

    // Manual readings (pH, TDS/PPM, EC)
    const avgPAR = avgLightLux != null ? luxToPar(avgLightLux) : null;
    const manual = getReadings();
    const phVals = manual.map((r) => r.ph).filter((v) => v != null) as number[];
    const tdsVals = manual.map((r) => r.tds).filter((v) => v != null) as number[];
    const ecVals = manual.map((r) => r.ec).filter((v) => v != null) as number[];
    const phAvg = phVals.length ? (phVals.reduce((s, v) => s + v, 0) / phVals.length).toFixed(2) : "N/A";
    const tdsAvg = tdsVals.length ? (tdsVals.reduce((s, v) => s + v, 0) / tdsVals.length).toFixed(1) : "N/A";
    const ecAvg = ecVals.length ? (ecVals.reduce((s, v) => s + v, 0) / ecVals.length).toFixed(2) : "N/A";

    const prompt = `You are an expert hydroponics and vertical farming analyst. Analyze the following smart tower garden sensor data and provide concise insights, recommendations, and risk assessment. Use the attached indoor lettuce guide as reference — include humidity, pH, TDS/PPM, EC, ambient light, pump performance, and recent manual readings.

  Current Status:
  - Pump: ${currentStatus.pumpOn ? "ON" : "OFF"}
  - Fault: ${currentStatus.fault || "None"}
  - Grow Light: ${currentStatus.lightOn ? "ON" : "OFF"}
  - Ambient light (current): ${currentStatus.lightLux != null ? currentStatus.lightLux + " lux" : "N/A"}

  Sensor Summary (last ${days} days):
  - Humidity: Avg ${avgHumidity}% (Current: ${currentStatus.humidityPct?.toFixed(1) || "N/A"}%)
  - Ambient light: Avg ${avgLightLux != null ? avgLightLux + " lux" : "N/A"} (recent samples: ${lightLuxValues.length})
  - Manual readings: pH avg ${phAvg}, TDS/PPM avg ${tdsAvg}, EC avg ${ecAvg} (count: ${manual.length})
  - Sensor data points: ${sensorHistory.length}
  - Ambient light: Avg ${avgLightLux != null ? avgLightLux + " lux" : "N/A"} (recent samples: ${lightLuxValues.length})${avgPAR != null ? ` (~${avgPAR} μmol/m²/s PAR, factor=${DEFAULT_PAR_FACTOR})` : ""}

  Reference indoor lettuce targets (use these when making recommendations):
  - Target pH: 5.5–6.2 (aim for 5.8–6.0 in vegetative growth)
  - Target EC: 0.8–1.2 mS/cm (approx. 560–840 PPM using 700 factor). Seedling lower, vegetative higher.
  - Recommended LED photoperiod (indoor): 14–16 hours/day (example schedule: 5:00–21:00)
  - Indoor misting suggestion: typical fixed cycle ~2 min ON / 8 min OFF
  - Use ambient light lux thresholds for auto-on: consider ~2000 lux as conservative indoor threshold for supplemental LEDs

  Please provide:
  1. A system health score (1-100)
  2. 3 concise observations
  3. 3-6 actionable recommendations (include light scheduling recommendations for indoor LED use and lux thresholds)
  4. Any immediate risk factors or warnings
  5. Suggested adjustments to watering schedule, nutrient targets (pH/TDS/EC), and light automation if needed

  Return JSON with keys: "healthScore", "observations", "recommendations", "riskFactors", "summary". Use the reference targets above when proposing numeric recommendations.
  `;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logError("Gemini API error", new Error(error), { status: response.status });
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      logError("No response text from Gemini API", undefined, { dataKeys: Object.keys(data) });
      return null;
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logError("Could not find JSON in Gemini response", undefined, { responseLength: responseText.length });
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      healthScore?: number;
      recommendations?: string[];
      riskFactors?: string[];
      summary?: string;
      observations?: string;
    };

    const result = {
      insights: parsed.observations || parsed.summary || "Analysis complete",
      recommendations: parsed.recommendations || [],
      healthScore: parsed.healthScore || 75,
      riskFactors: parsed.riskFactors || [],
    };

    // Cache the result
    cachedAnalysis = {
      response: result,
      timestamp: now,
      dataHash,
    };

    logInfo("Gemini analysis completed successfully", { healthScore: result.healthScore, recommendations: result.recommendations.length });
    return result;
  } catch (err) {
    logError("Error calling Gemini API", err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}
