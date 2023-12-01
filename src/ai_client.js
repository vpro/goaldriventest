// Copyright (c) Mathijn Elhorst.
// Licensed under the MIT license.
// This file provides the communication back and forth between the AI implementation

const OpenAI = require( 'openai' );
const fs = require( 'fs' );

// Chose to keep it a simple client where you pass in multiple prompts and get back multiple responses
// format of in- and output is the same: { role: string, content: [ { type: "text", text: string } / { type: "image_url", image_url: string } ] }
// role is either "user", "assistant" or "system"
// content is an array containing either text or image_url
// The input format is the same as OpenAI's chat API, but the output format is different
// Let's see how long this holds...

class AIClient {
    prompt_history = [];

    /**
     * Function that passes the prompt to the AI and returns the responsem, both in the same format.
     * 
     * @param {object} prompt { role: string, content: [ { type: "text", text: string } / { type: "image_url", image_url: string } ] }
     * @returns {object} { role: string, content: [ { type: "text", text: string } / { type: "image_url", image_url: string } ] }
     */
    async processPrompt( prompt ) {
        throw new Error( 'Must be implemented by subclass' );
    }

    /**
     * Add system prompt for the initial prompt initialization
     * There is no response for this prompt, it will be sent as part of history for the next prompt
     */
    async addSystemPrompt( textPrompt ) {
        const prompt = { role: 'system', content: [{ type: 'text', text: textPrompt }] };
        this.prompt_history.push( prompt );
    }

    /** 
     * Function that returns the current prompt history.
     */
    getPromptHistory() {
        return this.prompt_history; 
    }

    /**
     * Function that clears the current prompt history.
     */
    clearPromptHistory() {
        this.prompt_history = [];
    }    

    /**
     * Function that writes all prompts to a file
     */
    writePromptHistoryToFile( filename ) {
        const file = fs.openSync( filename, 'w' );
        if ( file !== undefined ) {
            fs.writeSync( file, JSON.stringify( this.prompt_history, null, 4 ) );
            fs.closeSync( file );
        } else {
            throw new Error( 'AIClient::writePromptHistoryToFile: Could not open file ' + filename );
        }    
    }    

    /**
     * Function that returns the prompt history rewritten to contain only text
     */
    getPromptHistoryTextOnly() {
        return this.prompt_history.map( prompt => {
            return {
                role: prompt.role,
                content: prompt.content.filter( content => content.type === 'text' ).map( content => {
                    return content;
                } )
            };
        } );
    }

    // Helper functions to create prompts

    /**
     * 
     * @param {string} textPrompt 
     * @returns see processPrompt(...)
     */
    async processTextPrompt( textPrompt ) {
        const prompt = { role: 'user', content: [{ type: 'text', text: textPrompt }] };
        const response = await this.processPrompt( prompt );
        
        return response;
    }
   
}

class OpenAIClient extends AIClient {
    openaiAPI = null;
    openaiModel = 'gpt-4-vision-preview';
    max_tokens = 350;

    constructor( key, openaiModel, max_tokens ) {
        super();

        if ( !key || key.length === 0 ) {
            throw new Error( 'OpenAI API key (OPENAI_API_KEY) not found in environment variables' );
        }

        this.openaiModel = openaiModel;
        this.max_tokens = max_tokens;
        this.openaiAPI = new OpenAI( {
            apiKey: key
        } );
    }

    async processPrompt( prompt ) {
        let temp_prompt_messages = this.getPromptHistoryTextOnly();
        console.log( 'Prompt: ' + JSON.stringify( temp_prompt_messages, null, 4 ) );
        temp_prompt_messages.push( prompt );


        const apiResponse = await this.openaiAPI.chat.completions.create( {
            messages: temp_prompt_messages,
            max_tokens: this.max_tokens,
            model: this.openaiModel
        } );    

        if ( apiResponse.choices.length === 0 ) {
            throw new Error( 'No response from OpenAI' );
        }
        if ( apiResponse.choices[0].finish_details.type !== 'stop' ) {
            console.log( 'Failure: ' + apiResponse );
            throw new Error( 'OpenAI did not finish but gave as failure reason: ' + apiResponse.choices[0].finish_details.type );
        }
        if ( !apiResponse.choices[0].message.content ) {
            throw new Error( 'OpenAI did not return any content' );
        }

        // We have success, now add the prompt to the prompt history and return the response
        this.prompt_history.push( prompt );
        // todo: response can in the future also contan images or even more text... 
        const response = { role: 'assistant', content: [{ type: 'text', text: apiResponse.choices[0].message.content }] };
        this.prompt_history.push( response );

        return response;
    }
}

/**
 * This class is used to replay a previously recorded conversation
 * It can read the format as written by writePromptHistoryToFile in the base class
 * 
 */
class AIPlaybackClient extends AIClient {
    recordedPrompts = [];

    constructor( filename ) {
        super();

        this.recordedPrompts = this.read_prompts( filename );
    }

    getNumberOfSteps() {
        return this.recordedPrompts.length;
    }

    async processPrompt( prompt ) {
        if ( this.recordedPrompts.length == 0 ) {
            throw new Error( 'No more recorded prompts available' );
        }
        const recordedPrompt = this.recordedPrompts.shift();
        this.prompt_history.push( prompt );
        this.prompt_history.push( recordedPrompt );
        
        return recordedPrompt;
    }

    read_prompts( filename ) {
        const allmessages = JSON.parse( fs.readFileSync( filename, 'utf8' ) );
        const messages = allmessages.filter( prompt_message => prompt_message.role === 'assistant' );
        // if old format, convert to new format
        if ( messages.length !== 0 && messages[0].content !== undefined && messages[0].content[0].type === undefined ) {
            return messages.map( prompt_message => {
                return {
                    role: prompt_message.role,
                    content: [{ type: 'text', text: prompt_message.content }]
                };
            } );
        }
        
        return messages;
    } 

 
}

module.exports = {
    AIClient,
    OpenAIClient,
    AIPlaybackClient
};
