// Copyright (c) VPRO
// Licensed under the MIT license.
// Author: Mathijn Elhorst.
//
// This file provides the communication back and forth between the AI implementation

import { OpenAI } from "openai";
import fs from "fs";

// Chose to keep it a simple client where you pass in multiple prompts and get back multiple responses
// format of in- and output is the same: { role: string, content: [ { type: "text", text: string } / { type: "image_url", image_url: string } ] }
// role is either "user", "assistant" or "system"
// content is an array containing either text or image_url
// The input format is the same as OpenAI's chat API, but the output format is different
// Let's see how long this holds...

export interface Prompt {
  role: string;
  content: Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export function createTextPrompt(role: string, text: string): Prompt {
  return {
    role,
    content: [{ type: "text", text: text }],
  };
}
export function createImagePrompt(
  role: string,
  text: string,
  imageUrl: string,
): Prompt {
  return {
    role,
    content: [
      { type: "text", text: text },
      { type: "image_url", image_url: { url: imageUrl } },
    ],
  };
}

class AIClient {
  private _promptHistory: Prompt[] = [];

  /**
   * Function that passes the prompt to the AI and returns the response
   */
  async processPrompt(prompt: Prompt): Promise<Prompt> {
    throw new Error("Must be implemented by subclass");
  }

  /**
   * Add system prompt for the initial prompt initialization
   * There is no response for this prompt, it will be sent as part of history for the next prompt
   */
  async addSystemPrompt(textPrompt: string): Promise<void> {
    const prompt: Prompt = {
      role: "system",
      content: [{ type: "text", text: textPrompt }],
    };
    this.storePrompt(prompt);
  }

  /**
   * Function that returns the current prompt history.
   */
  getPromptHistory(): Prompt[] {
    return this._promptHistory;
  }

  /**
   * Function that clears the current prompt history.
   */
  clearPromptHistory(): void {
    this._promptHistory = [];
  }

  /**
   * Function that stores a prompt in the prompt history.
   */
  storePrompt(prompt: Prompt): void {
    this._promptHistory.push(prompt);
  }

  /**
   * Function that writes all prompts to a file
   */
  writePromptHistoryToFile(filename: string): void {
    const file = fs.openSync(filename, "w");
    if (file !== undefined) {
      fs.writeSync(file, JSON.stringify(this._promptHistory, null, 4));
      fs.closeSync(file);
    } else {
      throw new Error(
        `AIClient::writePromptHistoryToFile: Could not open file ${filename}`,
      );
    }
  }

  /**
   * Function that returns the prompt history rewritten to contain only text
   */
  getPromptHistoryTextOnly(): Prompt[] {
    return this._promptHistory.map((prompt) => ({
      role: prompt.role,
      content: prompt.content
        .filter((content) => content.type === "text")
        .map((content) => content),
    }));
  }
}

class OpenAIClient extends AIClient {
  private _openaiAPI: OpenAI;

  private _openaiModel = "gpt-4-vision-preview";

  private _maxTokens = 350;

  constructor(key: string, openaiModel: string, maxTokens: number) {
    super();

    if (!key || key.length === 0) {
      throw new Error(
        "OpenAI API key (OPENAI_API_KEY) not found in environment variables",
      );
    }

    this._openaiModel = openaiModel;
    this._maxTokens = maxTokens;
    this._openaiAPI = new OpenAI({
      apiKey: key,
    });
  }

  async processPrompt(prompt: Prompt): Promise<Prompt> {
    const tempPromptMessages = this.getPromptHistoryTextOnly();
    tempPromptMessages.push(prompt);

    const apiResponse = await this._openaiAPI.chat.completions.create({
      messages: tempPromptMessages as any,
      max_tokens: this._maxTokens,
      model: this._openaiModel,
    });

    if (apiResponse.choices.length === 0) {
      throw new Error("No response from OpenAI");
    }
    if ((apiResponse.choices[0] as any).finish_details.type !== "stop") {
      throw new Error(
        `OpenAI did not finish but gave as failure reason: ${
          (apiResponse.choices[0] as any).finish_details.type
        }\nThe complete response was: ${JSON.stringify(apiResponse)}`,
      );
    }
    if (!apiResponse.choices[0].message.content) {
      throw new Error("OpenAI did not return any content");
    }

    // We have success, now add the prompt to the prompt history and return the response
    this.storePrompt(prompt);
    // in the future the response can also contain images or even more text...
    const response = createTextPrompt(
      "assistant",
      apiResponse.choices[0].message.content,
    );
    this.storePrompt(response);

    return response;
  }
}

/**
 * This class is used to replay a previously recorded conversation
 * It can read the format as written by writePromptHistoryToFile in the base class
 *
 */
class AIPlaybackClient extends AIClient {
  private _recordedPrompts: Prompt[];

  constructor(filename: string) {
    super();

    this._recordedPrompts = this._readPrompts(filename);
  }

  getNumberOfSteps(): number {
    return this._recordedPrompts.length;
  }

  async processPrompt(prompt: Prompt): Promise<Prompt> {
    const recordedPrompt = this._recordedPrompts.shift();
    if (!recordedPrompt) {
      throw new Error("No more recorded prompts available");
    }
    this.storePrompt(prompt);
    this.storePrompt(recordedPrompt);

    return recordedPrompt;
  }

  private _readPrompts(filename: string): Prompt[] {
    const allmessages = JSON.parse(fs.readFileSync(filename, "utf8"));
    const messages = allmessages.filter(
      (promptMessage: any) => promptMessage.role === "assistant",
    );
    // if old format, convert to new format
    if (
      messages.length !== 0 &&
      messages[0].content !== undefined &&
      messages[0].content[0].type === undefined
    ) {
      return messages.map((promptMessage: any) => ({
        role: promptMessage.role,
        content: [{ type: "text", text: promptMessage.content }],
      }));
    }

    return messages;
  }
}

export { AIClient, OpenAIClient, AIPlaybackClient };
