# Explanations in plain words

In the Inbox, **Explain in plain words** asks a language model to explain a recommendation: what
the change does, why it saves money or protects the site at that time, and what its checks mean.
Owners and managers ask; everyone on the site can read an explanation once it's written.

## Plug in a model

As the site's owner, open **Settings → Rules → Explanations**:

1. Pick a provider: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Together AI, Anthropic, or
   **Other** for any OpenAI-compatible API (anything that serves `/chat/completions`).
2. Check the base URL, and enter the model's name as the provider writes it.
3. Enter your API key and a monthly token budget (an explanation uses about 1,000 tokens).
4. **Test**, then **Save**.

The key is encrypted on the server and never shown again; the page shows only its last four
characters. **Remove my key** goes back to the server's default model, or turns explanations off.

A server can also have a default model for every site; see `LLM_*` in
[Configuration](../deploy/configuration.md#language-models). A site's own key takes its place.

## What the model sees

Only the recommendation's numbers, as the server has them: the rule, the kind of device, the action
and its settings, the time window, the checks and whether each passes, the calculation and the
expected saving. **Not sent:** device, vehicle and people's names, RFID tags, the site's name and
address, decline reasons, or anything typed in the request. Names that appear inside a check are
replaced ("the EV charger", "a person") first.

## Cost

An explanation is kept with the recommendation, so asking again is free until the recommendation
changes. Each site's tokens are counted per month against its budget; when it's used up, new
explanations stop until the 1st, and the ones already written stay.

## For operators

The base URL must be `https://` to a public address: the server makes the call, so it refuses
`localhost`, private and link-local addresses, bare service names and credentials in the URL.
To let owners use a model on their own network (Ollama, LM Studio, vLLM), set
`LLM_ALLOW_PRIVATE_URLS=true`, only where site owners are trusted. Saving keys needs
`SECRETS_KEY`.
