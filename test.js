const fs = require('fs');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { ArgumentParser } = require('argparse');
const { DateTime } = require('luxon');
const OpenAI = require('openai');
const actions = require('./actions.js');

console.log(actions);

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

// Prompt

// Argument parsing
const parser = new ArgumentParser();
parser.add_argument('url', { help: 'Starting URL' });
parser.add_argument('goal', { help: 'Goal of the test' });
parser.add_argument('-b', '--browser', { default: 'firefox', help: 'Browser to use (firefox or chrome)' });

const args = parser.parse_args();

let prompt = `
You are going to test a website. You will be given a URL and a screenshot of the website with that URL.  
You try to understand the screenshots content and layout. From that you determine what the next logical 
action will be to reach the given goal below. Do not repeat steps, look into your last actions for that.

Every time you receive a screenshot of the website you determine your next action. 
You return a JSON structure that contains that action in the following form, all other fields are required:
- "description": A brief description of the action you are going to perform.
- "action": # The action you are going to take, see below for the structure.
- "expectation": Your prediction of what will happen when the action is taken. You are going to check this in the next step!
- "step": A number representing the order or sequence of the action in achieving the goal.
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

prompt += `If there is any cookiebar present, please click it away first.

Please only output the JSON structure, nothing else.

Goal: ` + args.goal

function write_html (filename, prompt_messages, screenshots) 
{
    let html_content = `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>JSON Presentation</title>
		<style>
			.container {
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				justify-content: center;
			}
			.image {
				margin: 10px;
				cursor: pointer;
			}
			img {
				max-width: 600px;
				max-height: 600px;
			}
			.fullscreen {
				position: fixed;
				top: 0;
				left: 0;
				width: 100%;
				height: 100%;
				background-color: rgba(0, 0, 0, 0.9);
				display: flex;
				align-items: center;
				justify-content: center;
				z-index: 9999;
			}
			.fullscreen img {
				max-width: 100%;
				max-height: 100%;
			}
			.json {
				margin: 10px;
				padding: 10px;
				background-color: #f5f5f5;
				border-radius: 5px;
				box-shadow: 0 0 5px rgba(0, 0, 0, 0.3);
				overflow: auto;
				max-height: 80vh;
				width: 50%;
			}
			.json pre {
				white-space: pre-wrap;
			}
		</style>
	</head>
	<body>
		<div class="container">
	`;

	let step = 0
	prompt_messages.forEach(prompt_message => {
        if (prompt_message.role === "assistant") {
            let json_data = JSON.parse(prompt_message.content.replace('```json\n', '').replace('\n```', ''))
			html_content += `
			<div class="image" onclick="toggleFullscreen(this)">
				<img src="data:image/png;base64,`
            html_content += screenshots[step]
            html_content += '" alt="Screenshot ' + step + `">
			</div>
			<div class="json">
				<pre>{`
            html_content += JSON.stringify(json_data, null, 4)
            html_content += `}</pre>
			</div>
			`
			step += 1
        }
    });

	html_content += `
		</div>
		<script>
			function toggleFullscreen(element) {
				element.classList.toggle('fullscreen');
			}
		</script>
	</body>
	</html>
	`

    const file = fs.openSync(filename, 'w')
    if (file !== undefined) {
        fs.writeSync(file, html_content)
        fs.closeSync(file)
    }
}


// Main function
async function main() {
    let browser;
    if (args.browser === 'chrome') {
        browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
    } else if (args.browser === 'firefox') {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], product: 'firefox' });
    } else {
        throw new Error('Browser not recognized');
    }

    const page = await browser.newPage();
    await page.setViewport({width: 1024, height: 1366});
    const navigateResult = await page.goto(args.url);
    if (!navigateResult.ok()) {
        throw new Error('Could not navigate to URL');
    }

    // Our testing loop
    let step = 0;
    let achieved = false;
    const screenshots = [];
    let prompt_messages = [ { "role": "system", "content": prompt } ]

    while(step < MAX_STEPS && !achieved) { 
        await new Promise(resolve => setTimeout(resolve, BROWSER_DELAY_MSECS));

        // Label all clickable elements
        const scriptContents = fs.readFileSync('mark_clickable_objects.js', 'utf8');
        await page.evaluate(scriptContents);

        // Make a screenshot
        screenshots.push(await page.screenshot({ type: 'jpeg', encoding: "base64" }));

        // Let OpenAI decide what action to take given the screenshot and the prompt
        let temp_prompt_messages = prompt_messages
        temp_prompt_messages.push({
		    role: 'user',
			content: [
				{
					type: 'text',
					text: 'This is step ' + step + '. Continue with this image, what\'s your next action?'
				},
				{
					type: 'image_url',
					image_url: {
						url: 'data:image/jpeg;base64,' + screenshots[step]
					}
				}
			]
		})

        
        const response = {
            choices: [
                {
                    message: {
                    role: 'assistant',
                    content: '```json\n' +
                        '{\n' +
                        `  "description": "Click the 'word abonnee' button to potentially navigate to a login or registration page",\n` +
                        '  "action": {\n' +
                        '    "actionType": "scroll",\n' +
                        '    "elementNumber": 3,\n' +
                        '    "distance": "little",\n' +
                        '    "direction": "down"\n' +
                        '  },\n' +
                        '  "expectation": "Clicking this button might open a login screen or a registration page where a login option is available.",\n' +
                        '  "step": 1,\n' +
                        '  "achieved": false,\n' +
                        '  "previousExpectation": "",\n' +
                        '  "expectationSatisfied": true,\n' +
                        '  "goal": "login",\n' +
                        '  "frustrationLevel": 1,\n' +
                        '  "frustrationLevelReason": "Just starting the process, no frustration encountered yet."\n' +
                        '}\n' +
                        '```'
                    },
                    finish_details: { type: 'stop', stop: '<|fim_suffix|>' }
                }
            ]
        }
/*
        const response = await openai.chat.completions.create({
            messages: temp_prompt_messages,
            max_tokens: 300,
            model: openaiModel,
        });
*/
        if (response.choices.length === 0) {
            throw new Error('No response from OpenAI');
        }
        if (response.choices[0].finish_details.type !== 'stop') {
            throw new Error('OpenAI did not finish but gave an other failure reason: ' + response.choices[0].finish_details.type);
        }
        prompt_messages.push({ role: 'user', content: 'Continue with this image, what\'s your next action?' });
        prompt_messages.push({ role: 'assistant', 'content': response.choices[0].message.content });
console.log(prompt_messages);

        let jsonString = response.choices[0].message.content.replace('```json\n', '').replace('\n```', '');
        let jsonObject = JSON.parse(jsonString);

        console.log(jsonObject);
        write_html ("test123.html", prompt_messages, screenshots);

        if (jsonObject.achieved === true) {
            achieved = true;
            console.log('Goal achieved!');
            break;
        }
        if (jsonObject.action === undefined || jsonObject.action.actionType === undefined) {
            throw new Error('No valid action defined');
        }

        // Perform the action
        const action = actions[jsonObject.action.actionType];
        if (!action) {
            throw new Error('Action not recognized');
        }
        await action.perform(page, jsonObject.action);

        step += 1;
    }
    if (!achieved) {
        console.log('Maximum number of steps (' + MAX_STEPS + ') reached');
    }
    // Close browser
    await browser.close();
}

// Run the main function
main().catch(console.error);


