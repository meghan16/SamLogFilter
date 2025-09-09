const { AzureOpenAI } = require("openai");
const { DefaultAzureCredential, getBearerTokenProvider } = require("@azure/identity");

// You will need to set these environment variables or edit the following values
const endpoint = process.env.AZURE_OPENAI_ENDPOINT || "https://msaitwal-foundry.openai.azure.com/";
const apiVersion = process.env.OPENAI_API_VERSION || "2024-05-01-preview";
const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o-mini"; // This must match your deployment name.

// Keyless authentication
const credential = new DefaultAzureCredential();
const scope = "https://cognitiveservices.azure.com/.default";
const azureADTokenProvider = getBearerTokenProvider(credential, scope);

async function main(logContent, keywords) {
  const client = new AzureOpenAI({ endpoint, apiVersion, azureADTokenProvider, deployment });
  const result = await client.chat.completions.create({
    messages: [
      { role: "system", content: "You are smart log filtering assistant." },
      { role: "user", content: logContent },
      { role: "user", content: "Filter all lines related or containing any of " + keywords + " from above logs. Do not show results for keywords separately." },
    ],
    model: "",
  });
  let output = "";
  for (const choice of result.choices) {
    output += choice.message.content + "\n";
  }
  // Wrap output in Markdown code block for formatting
  return `\n<pre><code>${output.trim()}</code></pre>`;
}

// main() is now used by server.js for API calls

module.exports = { main };
