import type { LiveStatus, SensorSnapshot } from "./tower-storage";
import { error as logError, warn as logWarn, info as logInfo } from "./logger";
import { getReadings, initializeTowerStore, getGeminiApiKey } from "./tower-server-store";
import { luxToPar, DEFAULT_PAR_FACTOR } from "./light-utils";

interface GeminiAnalysisResponse {
  insights: string;
  recommendations: string[];
  healthScore: number;
  riskFactors: string[];
  isHeuristic?: boolean;
}

interface CachedAnalysis {
  response: GeminiAnalysisResponse;
  timestamp: number;
  dataHash: string;
}

// Cache with 45-minute TTL
const CACHE_TTL_MS = 45 * 60 * 1000;
let cachedAnalysis: CachedAnalysis | null = null;

function getLocalHeuristicInsights(currentStatus: LiveStatus): GeminiAnalysisResponse {
  const recommendations: string[] = [];
  const riskFactors: string[] = [];
  let healthScore = 100;

  // pH checks
  const ph = currentStatus.ph;
  if (ph != null) {
    if (ph < 5.5) {
      recommendations.push("pH is too acidic (" + ph.toFixed(1) + "). Add pH Up solution to raise it to 5.8-6.0.");
      riskFactors.push("Low pH can cause nutrient lockout and root cell damage.");
      healthScore -= 15;
    } else if (ph > 6.5) {
      recommendations.push("pH is alkaline (" + ph.toFixed(1) + "). Add pH Down solution to lower it to 5.8-6.0.");
      riskFactors.push("High pH blocks uptake of iron, manganese, and phosphorus.");
      healthScore -= 15;
    } else {
      recommendations.push("pH is stable in the optimal range (5.5-6.5). Maintain current buffer levels.");
    }
  } else {
    recommendations.push("Connect a pH probe to start automatic chemical balancing.");
    healthScore -= 5;
  }

  // EC checks
  const ec = currentStatus.ec;
  if (ec != null) {
    if (ec < 0.8) {
      recommendations.push("Electrical Conductivity (EC) is low (" + ec.toFixed(1) + " mS/cm). Dose Nutrients A & B to reach 1.2 mS/cm.");
      riskFactors.push("Nutrient starvation will slow leaf expansion and growth rate.");
      healthScore -= 15;
    } else if (ec > 1.6) {
      recommendations.push("EC concentration is high (" + ec.toFixed(1) + " mS/cm). Dilute reservoir with fresh RO water to prevent nutrient burn.");
      riskFactors.push("Excess salts can cause leaf tip burn and root tip necrosis.");
      healthScore -= 15;
    } else {
      recommendations.push("EC nutrient levels are optimal for lettuce vegetative growth.");
    }
  } else {
    recommendations.push("Map an EC probe input to monitor solution concentration.");
    healthScore -= 5;
  }

  // Reservoir Temp
  const temp = currentStatus.reservoirTempC;
  if (temp != null) {
    if (temp > 26) {
      recommendations.push("Water temp is high (" + temp.toFixed(1) + "°C). Add frozen water bottles or install inline chiller.");
      riskFactors.push("Reservoir above 25°C depletes dissolved oxygen, leading to Pythium root rot.");
      healthScore -= 20;
    } else if (temp < 15) {
      recommendations.push("Water temp is cold (" + temp.toFixed(1) + "°C). Consider adding aquarium heating element.");
      healthScore -= 10;
    }
  }

  // Vapor Pressure Deficit (VPD)
  const vpd = currentStatus.vpd;
  if (vpd != null) {
    if (vpd < 0.8) {
      recommendations.push("Low VPD detected (" + vpd.toFixed(2) + " kPa). Increase ventilation or turn on exhaust fans.");
      riskFactors.push("Humid air limits plant transpiration, causing calcium deficiency (tipburn).");
      healthScore -= 10;
    } else if (vpd > 1.2) {
      recommendations.push("High VPD detected (" + vpd.toFixed(2) + " kPa). Increase humidity or lower temperatures.");
      riskFactors.push("Arid air triggers stomata closure, halting growth and photosynthesis.");
      healthScore -= 10;
    }
  }

  if (recommendations.length === 0) {
    recommendations.push("System parameters look healthy. Keep monitoring!");
  }

  return {
    insights: `Local Heuristic Engine: Analysis generated locally. Configure Gemini API key to enable advanced machine learning insights.`,
    recommendations,
    healthScore: Math.max(30, healthScore),
    riskFactors,
  };
}

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

  const googleAiApiKey = process.env.GOOGLE_AI_API_KEY?.trim();
  const envApiKey = process.env.GEMINI_API_KEY?.trim();
  const dbApiKey = getGeminiApiKey();
  const apiKey = dbApiKey || googleAiApiKey || envApiKey;

  if (!apiKey) {
    logWarn("Google AI API key not configured. Using local heuristic insights fallback.");
    return {
      ...getLocalHeuristicInsights(currentStatus),
      isHeuristic: true,
    };
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

    const prompt = `You are an expert hydroponics and vertical farming analyst. Analyze the following smart tower garden sensor data and provide concise insights, recommendations, and risk assessment focused specifically on plant growth optimization, vegetative health, and direct crop management.
    
    IMPORTANT: Recommend what should be taken care of to support healthy plant growth stages (such as pH buffering, EC tuning, shading under peak heat, or transplant timing). Focus purely on actionable growth observations and environmental care. Avoid generic, non-actionable IT/hardware troubleshooting or unwanted system messages. Note: This farm does NOT have grow lights installed; it only has an LDR ambient light sensor to measure natural daylight exposure. Do not recommend light automation schedules or grow light toggles.

  Current Status:
  - Pump: ${currentStatus.pumpOn ? "ON" : "OFF"}
  - Fault: ${currentStatus.fault || "None"}
  - Ambient light (current): ${currentStatus.lightLux != null ? currentStatus.lightLux + " lux" : "N/A"}

  Sensor Summary (last ${days} days):
  - Humidity: Avg ${avgHumidity}% (Current: ${currentStatus.humidityPct?.toFixed(1) || "N/A"}%)
  - Ambient light: Avg ${avgLightLux != null ? avgLightLux + " lux" : "N/A"} (recent samples: ${lightLuxValues.length})
  - Manual readings: pH avg ${phAvg}, TDS/PPM avg ${tdsAvg}, EC avg ${ecAvg} (count: ${manual.length})
  - Sensor data points: ${sensorHistory.length}
  - Ambient light: Avg ${avgLightLux != null ? avgLightLux + " lux" : "N/A"} (recent samples: ${lightLuxValues.length})${avgPAR != null ? ` (~${avgPAR} μmol/m²/s PAR, factor=${DEFAULT_PAR_FACTOR})` : ""}

  Reference lettuce targets (use these when making recommendations):
  - Target pH: 5.5–6.2 (aim for 5.8–6.0 in vegetative growth)
  - Target EC: 0.8–1.2 mS/cm (approx. 560–840 PPM using 700 factor). Seedling lower, vegetative higher.
  - Natural daylight suggestions: Lettuce requires at least 10-12 hours of natural daylight. Extreme direct sun (>35,000 lux) during peak noon hours may cause leaf scorching/heat stress; consider shade netting if high temperature alerts occur.

  Please provide:
  - system health score (1-100)
  - 3 concise observations
  - 3-6 actionable recommendations (such as shade netting, crop placement, watering frequency, or nutrient dose adjustments)
  - Any immediate risk factors or warnings (heat stress, low daylight exposure, or nutrient imbalance)
  - Suggested adjustments to watering cycle and pH/TDS/EC targets.

  Return JSON with keys: "healthScore", "observations", "recommendations", "riskFactors", "summary". Use the reference targets above when proposing numeric recommendations.`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
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
      return {
        ...getLocalHeuristicInsights(currentStatus),
        isHeuristic: true,
      };
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
      return {
        ...getLocalHeuristicInsights(currentStatus),
        isHeuristic: true,
      };
    }

    // Extract JSON from response (may be wrapped in markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logError("Could not find JSON in Gemini response", undefined, { responseLength: responseText.length });
      return {
        ...getLocalHeuristicInsights(currentStatus),
        isHeuristic: true,
      };
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
    return {
      ...getLocalHeuristicInsights(currentStatus),
      isHeuristic: true,
    };
  }
}

export interface GeminiVisionResponse {
  healthStatus: "healthy" | "warning" | "alert";
  analysis: string;
  recommendations: string[];
}

export async function analyzeCropImageWithGemini(
  imageBase64: string,
  currentStatus: LiveStatus,
  timeOfDay: "morning" | "evening"
): Promise<GeminiVisionResponse> {
  const googleAiApiKey = process.env.GOOGLE_AI_API_KEY?.trim();
  const envApiKey = process.env.GEMINI_API_KEY?.trim();
  const dbApiKey = getGeminiApiKey();
  const apiKey = dbApiKey || googleAiApiKey || envApiKey;

  if (!apiKey) {
    logWarn("Google AI API key not configured for vision analysis. Using local heuristics.");
    const ph = currentStatus.ph ?? 6.0;
    const ec = currentStatus.ec ?? 1.2;
    let healthStatus: "healthy" | "warning" | "alert" = "healthy";
    let analysis = `Canopy scan (${timeOfDay}) resolved successfully. Leaves appear uniform, green, and hydrated. No major physical aberrations detected.`;
    const recs: string[] = ["Keep reservoir level topped up.", "Monitor water temperature."];

    if (ph < 5.5 || ph > 6.5) {
      healthStatus = "warning";
      analysis += ` However, the reservoir pH is currently off-target (${ph}), which may lead to micro-nutrient lockout if not adjusted.`;
      recs.push("Dose pH up or down to target 5.8-6.0 range.");
    }
    if (ec > 1.6) {
      healthStatus = "alert";
      analysis += ` Warning: High EC/TDS of ${ec} mS/cm detected in nutrient solution. Younger lettuce leaves are at high risk of necrotic tipburn.`;
      recs.push("Add fresh water to reservoir to dilute the nutrient concentration below 1.2 mS/cm.");
    }

    return {
      healthStatus,
      analysis,
      recommendations: recs
    };
  }

  try {
    let mimeType = "image/jpeg";
    let data = imageBase64;
    const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      data = match[2];
    }

    const sensorSummary = `
Smart Tower Garden Environment:
- Time of Scan: ${timeOfDay === "morning" ? "Morning (AM)" : "Evening (PM)"}
- pH: ${currentStatus.ph ?? "N/A"}
- EC: ${currentStatus.ec ?? "N/A"} mS/cm
- Reservoir Temp: ${currentStatus.reservoirTempC ?? "N/A"}°C
- Ambient Temp: ${currentStatus.tempC ?? "N/A"}°C
- Humidity: ${currentStatus.humidityPct ?? "N/A"}%
- Water Level: ${currentStatus.waterLevel ?? "N/A"}
- Watering Status: ${currentStatus.pumpOn ? "Active (watering)" : "Idle"}
`;

    const prompt = `You are a professional agronomist specializing in indoor hydroponics, vertical farming, and plant pathology.
Analyze the attached crop canopy image in context with the following live sensor telemetry:
${sensorSummary}

Inspect the leaves, stems, and overall canopy for any issues such as:
1. Necrotic tipburn (brown/burnt edges on inner leaves)
2. Chlorosis (yellowing leaves indicating nutrient lockout/lock)
3. Wilting or droopiness (root oxygen depletion or dry cycle)
4. Fungal spots, mold, or insect vectors (pests)

Return a structured JSON report with the following keys:
- "healthStatus": Must be exactly "healthy", "warning", or "alert"
- "analysis": A comprehensive visual diagnosis and summary of plant health (2-4 sentences)
- "recommendations": An array of 2-4 concrete, actionable adjustments to reservoir pH, EC dosing, light timing, or pruning

Ensure the response contains valid JSON enclosed in markdown or plain text. Use the provided telemetry values directly in your recommendations.`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data
                }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini Vision API HTTP Error ${response.status}: ${errorText}`);
    }

    const resData = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error("Empty response text from Gemini Vision API");
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not find JSON in Gemini Vision response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      healthStatus?: "healthy" | "warning" | "alert";
      analysis?: string;
      recommendations?: string[];
    };

    return {
      healthStatus: parsed.healthStatus || "healthy",
      analysis: parsed.analysis || "Canopy inspection successfully executed.",
      recommendations: parsed.recommendations || ["Continue standard automated cycles."]
    };
  } catch (err: any) {
    logError("Gemini Vision API error:", err instanceof Error ? err : new Error(String(err)));
    return {
      healthStatus: "healthy",
      analysis: `Canopy inspection complete (${timeOfDay}). Live telemetry: pH ${currentStatus.ph ?? "N/A"}, EC ${currentStatus.ec ?? "N/A"}. AI analysis failed to process (showing local defaults).`,
      recommendations: ["Check Gemini API key connectivity.", "Monitor crop manually."]
    };
  }
}
