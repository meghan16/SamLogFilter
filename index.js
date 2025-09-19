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
  // Wrap output in Markdown code block for formatting
  return `\n<pre><code>${ordered.join("\n")}</code></pre>`;
}

// main() is now used by server.js for API calls

module.exports = { main };
