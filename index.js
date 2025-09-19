const { AzureOpenAI } = require("openai");
const { DefaultAzureCredential, getBearerTokenProvider } = require("@azure/identity");

// You will need to set these environment variables or edit the following values
const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "https://msaitwal-foundry.openai.azure.com/";
const apiVersion = process.env.OPENAI_API_VERSION || "2024-05-01-preview";
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o-mini"; // This must match your deployment name.
const openaiApiKey = process.env.OPENAI_API_KEY || "Dp2acyrPsoIsfhHpdXYfFjlO9RLT2Q9x9eQvqA2DyyPWx4PocR8vJQQJ99BHACYeBjFXJ3w3AAAAACOGDcAJ";

// Keyless authentication for Azure
const credential = new DefaultAzureCredential();
const scope = "https://cognitiveservices.azure.com/.default";
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

async function main(logContent, keywords) {
  let client;
  if (openaiApiKey) {
    // Use AzureOpenAI with API key
    client = new AzureOpenAI({ endpoint, apiVersion, apiKey: openaiApiKey, deployment });
  } else {
    // Use AzureOpenAI with Azure AD token provider
    client = new AzureOpenAI({ endpoint, apiVersion, azureADTokenProvider, deployment });
  }

  // Split keywords by ',' or '+' and trim whitespace
  const keywordList = keywords
    .split(/[,\+]/)
    .map(k => k.trim())
    .filter(Boolean);
  // Collect all filtered lines from all keywords
  let allFilteredLines = [];
  for (const keyword of keywordList) {
    // Always perform a local, case-insensitive substring match so we never miss lines
    const logLinesOriginal = logContent.split(/\r?\n/); // keep original spacing (trim later for ordering)
    const kwLower = keyword.toLowerCase();
    for (const ln of logLinesOriginal) {
      if (ln.toLowerCase().includes(kwLower)) {
        allFilteredLines.push(ln.trim());
      }
    }

    // Also ask the model for "related" lines (context-aware) but instruct it to preserve original lines exactly.
    try {
      const result = await client.chat.completions.create({
        messages: [
          { role: "system", content: "You are a precise log filtering assistant. Always return exact original log lines verbatim without modification." },
          { role: "user", content: logContent },
          { role: "user", content: `Filter (case-insensitive) all original log lines that are related to OR contain the keyword '${keyword}'. Return ONLY the exact original lines (no reformatting, no added text), one per line. If none, return nothing.` },
        ],
        model: "",
      });
      for (const choice of result.choices) {
        const lines = choice.message.content
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean);
        allFilteredLines.push(...lines);
      }
    } catch (err) {
      // Swallow model errors so local matching still works
      // console.warn("Model filtering failed for keyword", keyword, err.message);
    }
  }
  // Remove duplicates
  const uniqueLines = Array.from(new Set(allFilteredLines));
  // Re-arrange based on original log order
  const logLines = logContent.split(/\r?\n/).map(l => l.trim());
  const ordered = logLines.filter(line => uniqueLines.includes(line));

  // Post-processing enrichment: decode capability bytes and system protection policy if present
  const enriched = ordered.map(line => {
    // Capability Bytes pattern e.g., "Capability Bytes 8f fb" (case-insensitive)
    const capMatch = /capability bytes\s+([0-9a-fA-F]{2})[\s:,]+([0-9a-fA-F]{2})/i.exec(line);
    if (capMatch) {
      try {
        const b1 = parseInt(capMatch[1], 16);
        const b2 = parseInt(capMatch[2], 16);
        if (typeof decodeCapabilityBytes === 'function') {
          const decoded = decodeCapabilityBytes([b1, b2]);
          return line + `  // Decoded: ${decoded.summary}`;
        }
      } catch (_) { /* ignore decoding errors */ }
    }
    // System Protection Policy pattern: "System Protection Policy 0x.. Protection Mask 0x.."
    const protMatch = /system protection policy\s+0x([0-9a-fA-F]+)\s+protection mask\s+0x([0-9a-fA-F]+)/i.exec(line);
    if (protMatch) {
      try {
        const policyVal = parseInt(protMatch[1], 16);
        const maskVal = parseInt(protMatch[2], 16);
        if (typeof decodeSystemProtection === 'function') {
          const decodedProt = decodeSystemProtection(policyVal, maskVal);
            return line + `  // Decoded: ${decodedProt.summary}`;
        }
      } catch (_) { /* ignore */ }
    }
    return line;
  });
  // Wrap output in Markdown code block for formatting
  return `\n<pre><code>${enriched.join("\n")}</code></pre>`;
}

// main() is now used by server.js for API calls

// System Protection Policy decoder based on ExtSamSystemProtectionPolicy_t
// policyValue: current active bits
// maskValue: bits implemented/available
function decodeSystemProtection(policyValue, maskValue) {
  const BIT_MAP = {
    0: 'BATTERY_LIMIT',
    1: 'THERMAL_OVERRIDE',
    2: 'DISPLAY_OVERRIDE',
    3: 'CUT_THE_TOP',
    4: 'BATTERY_CHARGE_LIMIT'
  };

  const supported = [];
  const active = [];
  const inactive = [];
  Object.entries(BIT_MAP).forEach(([bitStr, name]) => {
    const bit = parseInt(bitStr, 10);
    const mask = 1 << bit;
    if (maskValue & mask) {
      supported.push(name);
      if (policyValue & mask) active.push(name); else inactive.push(name);
    }
  });
  const unsupported = Object.entries(BIT_MAP)
    .filter(([bitStr]) => !(maskValue & (1 << parseInt(bitStr, 10))))
    .map(([, name]) => name);

  return {
    raw: { policyValue, maskValue },
    hex: { policyValue: '0x' + policyValue.toString(16).padStart(2, '0'), maskValue: '0x' + maskValue.toString(16).padStart(2, '0') },
    supported,
    active,
    inactive,
    unsupported,
    summary: `Supported:[${supported.join(', ')}] Active:[${active.join(', ')}] Inactive:[${inactive.join(', ')}] Unsupported:[${unsupported.join(', ')}]`
  };
}

// Capability bytes decoder (added earlier) may not exist if user reverted; guard require scenario
function decodeCapabilityBytes(input) {
  // Lightweight duplicate to ensure integration works if earlier addition was reverted.
  // If a more complete version exists elsewhere, this one will be shadowed.
  const ACPI_CAP_BITS = { 0x01: 'AC_WAKE', 0x02: 'DC_WAKE', 0x04: 'RT_SUPPORT', 0x08: 'RT_MS', 0x10: 'GWS_SUPPORT', 0x20: 'S4_AC_WAKE', 0x40: 'S5_AC_WAKE', 0x80: 'S4_DC_WAKE' };
  const BOOT_POLICY_BITS = { 0x01: 'AFTER_POWER_LOSS_TURN_ON', 0x02: 'BATTERY_ALWAYS_DISCONNECT', 0x04: 'ALWAYS_ON', 0x08: 'POWER_ON_PSU_CONNECT', 0x10: 'WAKE_ON_LID_OPEN', 0x20: 'WAKE_ON_LAN_ARMED', 0x40: 'BOOT_TO_OUT_OF_BOX_EXPERIENCE', 0x80: 'TEST_LAB_POWER_MODE' };
  let b1, b2;
  if (Array.isArray(input)) { [b1, b2] = input; } else { throw new Error('Unsupported input form'); }
  const decodeBits = (byte, map) => Object.keys(map).map(k => parseInt(k, 10)).filter(m => (byte & m) === m).map(m => map[m]);
  return { summary: `ACPI:[${decodeBits(b1, ACPI_CAP_BITS).join(', ')}] BootPolicy:[${decodeBits(b2, BOOT_POLICY_BITS).join(', ')}]` };
}

module.exports = { main, decodeSystemProtection, decodeCapabilityBytes };
