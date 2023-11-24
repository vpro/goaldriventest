// Copyright (c) Mathijn Elhorst.
// Licensed under the MIT license.
// Main file for the goal driven test
// This file contains the main function that runs the test

'use strict';

const fs = require('fs');
const axios = require('axios');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { ArgumentParser } = require('argparse');
const { DateTime } = require('luxon');
const OpenAI = require('openai');
const actions = require('./actions');
const { installMouseHelper } = require('./mouse_helper');
const { create_report } = require('./create_report');

// Set up OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key (OPENAI_API_KEY) not found in environment variables");
}

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});
const openaiModel = 'gpt-4-vision-preview';

// Other setup
const MAX_STEPS = 5;
const USE_ELEMENT_NUMBERS_FOR_CLICK = true;
const BROWSER_DELAY_MSECS = 4000; // Time in milliseconds
const SCREENSHOT_MAXSIZE = { width: 1024, height: 1024 };

// Prompt

// Argument parsing
const parser = new ArgumentParser();
parser.add_argument('url', { help: 'Starting URL' });
parser.add_argument('goal', { help: 'Goal of the test' });
parser.add_argument('filename', { help: 'Filename to store the results of the test' });

parser.add_argument('-b', '--browser', { default: 'chrome', help: 'Browser to use (firefox or chrome)' });
parser.add_argument('--playback', { help: 'playback the test run from the json file from a previous recording' });
parser.add_argument('--store', { help: 'Save the test run to json file for use by playback' });
parser.add_argument('--noheadless', { action: 'store_true', help: 'Don\'t use a headless browser' });
parser.add_argument('--stealth', { action: 'store_true', help: 'Add some HTTP headers to hide puppeteer usage' });
parser.add_argument('-m', '--maxsteps', { default: MAX_STEPS, help: 'The maximum number of steps to take' });
parser.add_argument('-e', '--emulate', { default: 'iPad Mini landscape', help: 'Emulate device' });
parser.add_argument('-l', '--list', { action: 'store_true', help: 'List possible devices' });
parser.add_argument('-V', '--version', { help: "version number", action: "version", version: "v0.1.0" });

const args = parser.parse_args();
const startime = DateTime.now()

let prompt = `
You are going to test a website. You will be given a URL and a screenshot of the website.  
You try to understand the screenshots content and layout. From that you determine what the next logical 
action will be to reach the given goal below. 
Look back through all previous actions (if any) to see what your intention was and what you expected to happen and follow up on your intentions. 
Change tactics to reach your goal if necessary. But do not repeat yourself!

Every time you receive a screenshot of the website you determine your next action. 
You return a JSON structure that contains that action in the following form, all other fields are required:
- "description": A brief description of the action you are going to perform. Use enough detail to use it to have a history of what you did to use in next steps.
- "action": # The action you are going to take, see below for the structure.
- "expectation": Your prediction of what will happen when the action is taken. You are going to check this in the next step!
- "step": A number representing the order or sequence of the action in achieving the goal.
- "url": The url of the screenshot you are looking at.
- "goal": Restate the overarching goal you are trying to reach.
- "achieved": A boolean (true or false) indicating if the goal has been achieved or not. If so, action can be empty as this run is finished.
- "previousExpectation": the expectation of the previous step.
- "expectationSatisfied": A boolean (true or false) indicating if the previous expectation was met. Remember to evaluate the expectation of the previous step to carefully determine if it was met or not.
- "frustrationLevel": A number between 1 and 10 indicating how frustrated you are with the website. 1 is not frustrated at all, 10 is very frustrated. 
- "frustrationLevelReason": A brief description of where your frustrationLevel is coming from.

The following actions are available:

`
for (const action in actions) {
    prompt += actions[action].getPromptInfo() + '\n\n';
}

prompt += `
Some things to take into consideration:
- If there is any cookiebar present, click it away first.
- To search something, start with a click on the text input field on the left of the search magnify glass icon or a search button. This will focus the input and display a (difficult to see) vertical cursor bar. Check for the latter in the next step and proceed with typing your search term. You can add a \n to the search string to immediately search, or you can click the search button or icon to perform the search in the next step. 
- Be very carefull to use elementNumbers only from the current screenshot, not from any previous action as numbers will change between screenshots!

Please only output the JSON structure, nothing else.

Goal: ` + args.goal

function write_prompts(filename, prompt_messages)
{
    const file = fs.openSync(filename, 'w')
    if (file !== undefined) {
        fs.writeSync(file, JSON.stringify(prompt_messages, null, 4));
        fs.closeSync(file);
    }
} 

function read_prompts(filename)
{
    let allmessages = JSON.parse(fs.readFileSync(filename, 'utf8'));
    let messages = []
    allmessages.forEach(prompt_message => {
        if (prompt_message.role === 'assistant') {
            messages.push(prompt_message);
        }
    });
    console.log(messages);
    return messages;
} 

async function get_screenshot(page, mark_clickable_objects = true)
{
    if (mark_clickable_objects) {
        // Label all clickable elements
        const scriptContents = fs.readFileSync('src/mark_clickable_objects.js', 'utf8');
        await page.evaluate(scriptContents);
    }

    // make the mouse visible
    installMouseHelper(page);

    // Make a screenshot
    const screenshotBinary = await page.screenshot({ type: 'jpeg', encoding: "binary" });
    if (screenshotBinary === undefined) {
        throw new Error('Could not create screenshot');
    }

    const screenshotBuf = await sharp(screenshotBinary)
        .resize(SCREENSHOT_MAXSIZE.width, SCREENSHOT_MAXSIZE.height, { fit: 'inside' })
        .jpeg({ quality: 100 })
        .toBuffer();

    return screenshotBuf.toString('base64');
}
// Main function
async function main() {
    if (args.list) {
        console.log('Possible devices to simulate:\n' + Object.keys(puppeteer.KnownDevices).join('\n'));
        return;
    }

    let browser;
    if (args.browser === 'chrome') {
        browser = await puppeteer.launch({ headless: (args.noheadless ? false : "new"), args: ['--no-sandbox'] });
        /* browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome',
            args: [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-sandbox'
            ]
        });*/
    } else if (args.browser === 'firefox') {
        browser = await puppeteer.launch({ headless: !args.noheadless, args: ['--no-sandbox'], product: 'firefox' });
    } else {
        throw new Error('Browser not recognized');
    }

    let playbackPromptMessages = []
    if (args.playback) {
        playbackPromptMessages = read_prompts(args.playback);
        if (args.maxsteps > playbackPromptMessages.length) {
            console.log("Info: maxsteps is larger than the number of steps in the playback file, setting maxsteps to " + playbackPromptMessages.length);
            args.maxsteps = playbackPromptMessages.length;
        }
    }

    const page = await browser.newPage();
    await page.emulate(puppeteer.KnownDevices[args.emulate]);
    if (args.stealth) {
        /* add for sites that block headless browsers */
        await page.setExtraHTTPHeaders({ 
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36', 
            'upgrade-insecure-requests': '1', 
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8', 
            'accept-encoding': 'gzip, deflate, br', 
            'accept-language': 'en-US,en;q=0.9,en;q=0.8' 
        });
    } 
    const navigateResult = await page.goto(args.url);
    if (!navigateResult.ok()) {
        throw new Error('Could not navigate to URL');
    }

    console.log('Starting test run');
    console.log('Goal: ' + args.goal);
    console.log('Starting URL: ' + args.url);

    const screenshots = [];
    const actionResults = [];
    let prompt_messages = [ { "role": "system", "content": prompt } ]

    await new Promise(resolve => setTimeout(resolve, BROWSER_DELAY_MSECS));
    screenshots.push(await get_screenshot(page, true));

    
    // Our testing loop
    let step = 0;
    let achieved = false;

    while(step < args.maxsteps && !achieved) { 
        console.log('Step ' + (step + 1));
 
        // Let OpenAI decide what action to take given the screenshot and the prompt
        let temp_prompt_messages = prompt_messages
        temp_prompt_messages.push({
		    role: 'user',
			content: [
				{
					type: 'text',
					text: 'This is step ' + step + '. Continue with this image, what\'s your next action? The url is ' + page.url()
				},
				{
					type: 'image_url',
					image_url: {
						url: 'data:image/jpeg;base64,' + screenshots[step]
					}
				}
			]
		})

        let response;
        if (args.playback && playbackPromptMessages.length > 0) {
            while (playbackPromptMessages.length && playbackPromptMessages[0].role !== 'assistant') {
                playbackPromptMessages.shift();
            }
            if (playbackPromptMessages.length === 0) {
                throw new Error('No more prompts in playback file');
            }

            response = {
                choices: [
                    {
                        message: playbackPromptMessages.shift(),
                        finish_details: { type: 'stop', stop: '<|fim_suffix|>' }
                    }
                ]
            }
        }
        else {
            response = await openai.chat.completions.create({
                messages: temp_prompt_messages,
                max_tokens: 350,
                model: openaiModel,
            });    
        }

        if (response.choices.length === 0) {
            throw new Error('No response from OpenAI');
        }
        if (response.choices[0].finish_details.type !== 'stop') {
            console.log("Failure: " + response);
            throw new Error('OpenAI did not finish but gave as failure reason: ' + response.choices[0].finish_details.type);
        }
        
        prompt_messages.push({ role: 'user', content: 'Continue with this image, what\'s your next action?' });
        prompt_messages.push({ role: 'assistant', 'content': response.choices[0].message.content });
    
        let jsonString = response.choices[0].message.content.replace('```json\n', '').replace('\n```', '');
        let jsonObject = JSON.parse(jsonString);
        console.log(jsonObject);

        if (jsonObject.achieved === false) {

            if (jsonObject.action === undefined || jsonObject.action.actionType === undefined) {
                throw new Error('No valid action defined');
            }

            // Perform the action
            const action = actions[jsonObject.action.actionType];
            if (!action) {
                throw new Error('Action not recognized');
            }
            const actionResult = await action.perform(page, jsonObject.action);
            actionResults.push(actionResult);
            console.log("Taking action: " + actionResult);
            await new Promise(resolve => setTimeout(resolve, BROWSER_DELAY_MSECS));
        }
        else {
            achieved = true;
        }

        screenshots.push(await get_screenshot(page, true));

        if (args.store) {
            write_prompts(args.store, prompt_messages);
        }
        create_report(args.filename, prompt_messages, screenshots, actionResults, args, startime);

        step += 1;
    }

    if (achieved) {
        console.log(`Goal achieved in ${step} ${step > 1 ? "steps" : "step"}!`);
        process.exitCode = 0;
    }
    else {
        process.exitCode = 1;
        if (step <= args.maxsteps) {
            console.log('Goal not achieved');
        }
        else {
            console.log('Maximum number of steps (' + args.maxsteps + ') reached');
        }
    }

    // Close browser
    await browser.close();
}

// Run the main function
main().catch(console.error);


