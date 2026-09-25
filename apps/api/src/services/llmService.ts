import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Lazy initialization to avoid errors when API keys are not set
let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;

const getOpenAI = (): OpenAI => {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
    });
  }
  return openai;
};

const getAnthropic = (): Anthropic => {
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
    });
  }
  return anthropic;
};

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const sendRequestToOpenAI = async (model: string, message: string): Promise<string> => {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model,
        messages: [{ role: 'user', content: message }],
        max_tokens: 1024,
      });
      const content = response.choices[0].message.content;
      if (!content) throw new Error('Empty response from OpenAI');
      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`Error sending request to OpenAI (attempt ${i + 1}):`, err.message);
      if (i === MAX_RETRIES - 1) throw error;
      await sleep(RETRY_DELAY);
    }
  }
  throw new Error('Failed to get response from OpenAI after retries');
};

const sendRequestToAnthropic = async (model: string, message: string): Promise<string> => {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      console.log(`Sending request to Anthropic with model: ${model} and message: ${message}`);
      const response = await getAnthropic().messages.create({
        model,
        messages: [{ role: 'user', content: message }],
        max_tokens: 1024,
      });
      console.log(`Received response from Anthropic: ${JSON.stringify(response.content)}`);
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text block in Anthropic response');
      }
      return textBlock.text;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`Error sending request to Anthropic (attempt ${i + 1}):`, err.message);
      if (i === MAX_RETRIES - 1) throw error;
      await sleep(RETRY_DELAY);
    }
  }
  throw new Error('Failed to get response from Anthropic after retries');
};

export const sendLLMRequest = async (message: string): Promise<string> => {
  const provider = (process.env.INSIGHT_LLM_PROVIDER || 'anthropic').toLowerCase();
  const model = process.env.INSIGHT_LLM_MODEL || 'claude-haiku-4-5';

  switch (provider) {
    case 'openai':
      return sendRequestToOpenAI(model, message);
    case 'anthropic':
      return sendRequestToAnthropic(model, message);
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
};
