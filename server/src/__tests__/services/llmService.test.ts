/**
 * LLM Service Tests
 *
 * Tests for LLM provider selection and request handling with retry logic
 */

import { sendLLMRequest } from '../../services/llmService';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

jest.mock('openai');
jest.mock('@anthropic-ai/sdk');

const mockOpenAI = OpenAI as jest.MockedClass<typeof OpenAI>;
const mockAnthropic = Anthropic as jest.MockedClass<typeof Anthropic>;

describe('LLM Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INSIGHT_LLM_PROVIDER = 'anthropic';
    process.env.INSIGHT_LLM_MODEL = 'claude-haiku-4-5';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  });

  describe('sendLLMRequest', () => {
    it('should use Anthropic provider by default', async () => {
      const mockResponse = {
        content: [{ type: 'text' as const, text: 'Test response' }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await sendLLMRequest('Test message');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5',
          messages: [{ role: 'user', content: 'Test message' }],
        })
      );
    });

    it('should use OpenAI provider when configured', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'openai';
      process.env.INSIGHT_LLM_MODEL = 'gpt-4';

      const mockResponse = {
        choices: [{ message: { content: 'OpenAI response' } }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockOpenAI.prototype.chat = { completions: { create: mockCreate } } as any;

      await sendLLMRequest('Test message');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Test message' }],
        })
      );
    });

    it('should throw error for unsupported provider', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'unsupported-provider';

      await expect(sendLLMRequest('Test message')).rejects.toThrow('Unsupported LLM provider');
    });

    it('should use default model if not specified', async () => {
      delete process.env.INSIGHT_LLM_MODEL;

      const mockResponse = {
        content: [{ type: 'text' as const, text: 'Test response' }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await sendLLMRequest('Test message');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5',
        })
      );
    });
  });

  describe('Anthropic Provider', () => {
    beforeEach(() => {
      process.env.INSIGHT_LLM_PROVIDER = 'anthropic';
    });

    it('should return text content from Anthropic response', async () => {
      const mockResponse = {
        content: [{ type: 'text' as const, text: 'Anthropic test response' }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      const result = await sendLLMRequest('Test message');

      expect(result).toBe('Anthropic test response');
    });

    it('should handle Anthropic errors gracefully', async () => {
      const mockCreate = jest
        .fn()
        .mockRejectedValue(new Error('Rate limited'));

      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await expect(sendLLMRequest('Test message')).rejects.toThrow();
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should fail after persistent Anthropic errors', async () => {
      const mockCreate = jest.fn().mockRejectedValue(new Error('Persistent error'));
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await expect(sendLLMRequest('Test message')).rejects.toThrow();
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should throw error if no text block in Anthropic response', async () => {
      const mockResponse = {
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse as any);
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await expect(sendLLMRequest('Test message')).rejects.toThrow('No text block in Anthropic response');
    });

    it('should handle case-insensitive provider name', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'ANTHROPIC';

      const mockResponse = {
        content: [{ type: 'text' as const, text: 'Test response' }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      const result = await sendLLMRequest('Test message');

      expect(result).toBe('Test response');
    });
  });

  describe('OpenAI Provider', () => {
    beforeEach(() => {
      process.env.INSIGHT_LLM_PROVIDER = 'openai';
      process.env.INSIGHT_LLM_MODEL = 'gpt-4';
    });

    it('should return content from OpenAI response', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'OpenAI test response' } }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockOpenAI.prototype.chat = { completions: { create: mockCreate } } as any;

      const result = await sendLLMRequest('Test message');

      expect(result).toBe('OpenAI test response');
    });

    it('should handle OpenAI errors gracefully', async () => {
      const mockCreate = jest
        .fn()
        .mockRejectedValue(new Error('Connection timeout'));

      mockOpenAI.prototype.chat = { completions: { create: mockCreate } } as any;

      await expect(sendLLMRequest('Test message')).rejects.toThrow();
      expect(mockCreate).toHaveBeenCalled();
    });

    it('should throw error if OpenAI returns empty content', async () => {
      const mockResponse = {
        choices: [{ message: { content: null } }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockOpenAI.prototype.chat = { completions: { create: mockCreate } } as any;

      await expect(sendLLMRequest('Test message')).rejects.toThrow('Empty response from OpenAI');
    });

    it('should pass correct parameters to OpenAI API', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockOpenAI.prototype.chat = { completions: { create: mockCreate } } as any;

      await sendLLMRequest('Test prompt');

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Test prompt' }],
        max_tokens: 1024,
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw error when provider is not configured', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'unsupported';

      await expect(sendLLMRequest('Test message')).rejects.toThrow('Unsupported LLM provider');
    });

    it('should handle LLM service failures', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'anthropic';

      const mockCreate = jest.fn().mockRejectedValue(new Error('Service unavailable'));
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await expect(sendLLMRequest('Test message')).rejects.toThrow();
    });
  });

  describe('Message Formatting', () => {
    it('should pass message as user role in messages array', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'anthropic';

      const mockResponse = {
        content: [{ type: 'text' as const, text: 'Response' }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await sendLLMRequest('My prompt');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'My prompt' }],
        })
      );
    });

    it('should set max_tokens for OpenAI', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'openai';

      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockOpenAI.prototype.chat = { completions: { create: mockCreate } } as any;

      await sendLLMRequest('Test');

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 1024 }));
    });

    it('should set max_tokens for Anthropic', async () => {
      process.env.INSIGHT_LLM_PROVIDER = 'anthropic';

      const mockResponse = {
        content: [{ type: 'text' as const, text: 'Response' }],
      };

      const mockCreate = jest.fn().mockResolvedValue(mockResponse);
      mockAnthropic.prototype.messages = { create: mockCreate } as any;

      await sendLLMRequest('Test');

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 1024 }));
    });
  });
});
