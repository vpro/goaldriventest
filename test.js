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
parser.add_argument('filename', { help: 'Filename to store the results of the test' });

parser.add_argument('-b', '--browser', { default: 'firefox', help: 'Browser to use (firefox or chrome)' });
parser.add_argument('--simulate', { help: 'Simulate the test run from the json file from a previous recording' });
parser.add_argument('--store', { help: 'Save the test run to json file for use by simulate' });

const args = parser.parse_args();
const startime = DateTime.now().toFormat('yyyy-LL-dd HH:mm:ss')

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

function write_prompts (filename, prompt_messages)
{
    const file = fs.openSync(filename, 'w')
    if (file !== undefined) {
        fs.writeSync(file, JSON.stringify(prompt_messages, null, 4));
        fs.closeSync(file);
    }
} 

let simulatePromptMessages = []
function read_prompts (filename)
{
    simulatePromptMessages = JSON.parse (fs.readFileSync(filename, 'utf8'));
} 

function write_html (filename, prompt_messages, screenshots, actionResults) 
{
    if (screenshots.length !== actionResults.length) {
        throw new Error('Number of screenshots and action results do not match');
    }

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
            .intro {
                border: 1px solid #ddd;
                padding: 15px;
                margin: 10px;
                border-radius: 5px;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
            }
            .intro h1 {
                color: #333;
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

            .action-card {
                border: 1px solid #ddd;
                padding: 15px;
                margin: 10px;
                border-radius: 5px;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
            }
            .action-card h2 {
                color: #333;
            }
            #action-icon {
                font-size: 3em;
            }            
		</style>
	</head>
	<body>
        <script>
        class Dial extends HTMLElement {
            constructor() {
                super();
                this.attachShadow({ mode: 'open' });
            }
        
            connectedCallback() {
                this.render();
            }
        
            render() {
                const level = parseInt(this.getAttribute('level') || 1);
                const angle = this.levelToAngle(level);
                const svgNS = "http://www.w3.org/2000/svg";
        
                // Create SVG
                const svg = document.createElementNS(svgNS, 'svg');
                svg.setAttribute('width', '200');
                svg.setAttribute('height', '120');
                svg.setAttribute('viewBox', '0 0 200 100');
        
                // Create semi-circular gradient
                const path = document.createElementNS(svgNS, 'path');
                path.setAttribute('d', 'M 10,90 A 80,80 0 0,1 190,90');
                path.style.fill = 'none';
                path.style.stroke = 'url(#gradient)';
                path.style.strokeWidth = '20';
                svg.appendChild(path);
        
                // Create pointer
                const line = document.createElementNS(svgNS, 'line');
                line.setAttribute('x1', '100');
                line.setAttribute('y1', '90');
                line.setAttribute('x2', '100');
                line.setAttribute('y2', '20');
                line.style.stroke = 'black';
                line.style.strokeWidth = '2';
                line.setAttribute('transform', \`rotate(\${angle} 100 90)\`);
                svg.appendChild(line);
        
                // Create gradient
                const defs = document.createElementNS(svgNS, 'defs');
                const linearGradient = document.createElementNS(svgNS, 'linearGradient');
                linearGradient.setAttribute('id', 'gradient');
                linearGradient.setAttribute('x1', '0%');
                linearGradient.setAttribute('y1', '0%');
                linearGradient.setAttribute('x2', '100%');
                linearGradient.setAttribute('y2', '0%');
                const stop1 = document.createElementNS(svgNS, 'stop');
                stop1.setAttribute('offset', '0%');
                stop1.setAttribute('stop-color', 'green');
                const stop2 = document.createElementNS(svgNS, 'stop');
                stop2.setAttribute('offset', '100%');
                stop2.setAttribute('stop-color', 'red');
                linearGradient.appendChild(stop1);
                linearGradient.appendChild(stop2);
                defs.appendChild(linearGradient);
                svg.appendChild(defs);
        
                // Clear and append new content
                this.shadowRoot.innerHTML = '';
                this.shadowRoot.appendChild(svg);
            }
        
            levelToAngle(level) {
                // Adjust the formula for a semi-circle (180 degrees)
                return (level - 1) * 18 - 90; // Assuming 10 levels, 180 degrees / 10 = 18 degrees per level, offset by -90 degrees
            }
        }
        
        // Define the new element
        customElements.define('my-dial', Dial);
        
        </script>        
		<div class="container">
	`;

    html_content += `<div class="intro">
    <h1>Goal: ${args.goal}</h1>
    <p>URL: ${args.url}</p>
    <p>Start time: ${startime}</p>
    <p>End time: ${DateTime.now().toFormat('yyyy-LL-dd HH:mm:ss')}</p>
    <p>Number of steps: ${actionResults.length}</p>
    <p>Goal achieved: ${actionResults.length > 0 && actionResults[actionResults.length - 1].achieved ? 'Yes' : 'No'}</p>
    <p>Browser: ${args.browser}</p>
    </div>`;            

	let step = 0
	prompt_messages.forEach(prompt_message => {
        if (prompt_message.role === "assistant") {
            let json_data = JSON.parse(prompt_message.content.replace('```json\n', '').replace('\n```', ''))

            const actionPayload = json_data.action;
            let action_Html = ""
            if (actionPayload) {
                const action = actions[actionPayload.actionType];
                console.log(action);
                if (!action) {
                    throw new Error('Action not recognized');
                }
                action_Html = action.getDescriptionHTML(actionPayload);
            }

			html_content += `<div class="image" onclick="toggleFullscreen(this)">
				<img src="data:image/png;base64,${screenshots[step]}" alt="Screenshot ${step}" />
			</div>
            <div class="action-card">
                <h2>Step ${step}</h2>
                <div class="action">
                    ${action_Html}
                    <p><b>Action result:</b> <span id="actionResult">${actionResults[step]}</span></p>                
                </div>
                <p><b>Description:</b> <span id="description">${json_data.description}</span></p>
                <p><b>Expectation:</b> <span id="expectation">${json_data.expectation}</span></p>
                <p/>
                <p><b>Expectation of previous step:</b> <span id="description">${json_data.previousExpectation}</span></p>
                <p><b>Expectation met:</b> <span id="expectation">${json_data.expectationSatisfied}</span></p>
                <div class="frustration-level">
                    <b>Frustration Level:</b>
                    <my-dial level="${json_data.frustrationLevel}"></my-dial>
                    <span id="frustrationLevel">${json_data.frustrationLevel}</span>
                </div>
                <p><b>Frustration Level Reason:</b> <span id="frustrationLevelReason">${json_data.frustrationLevelReason}.</span></p>
            </div>`;
            /*
			<div class="json">
				<pre>{`
            html_content += JSON.stringify(json_data, null, 4)
            html_content += `}</pre>
			</div>
			`*/
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

    if (args.simulate) {
        read_prompts(args.simulate);
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
    const actionResults = [];
    let prompt_messages = [ { "role": "system", "content": prompt } ]

    while(step < MAX_STEPS && !achieved) { 
        await new Promise(resolve => setTimeout(resolve, BROWSER_DELAY_MSECS));

        console.log('Step ' + step);
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

        let response;
        if (args.simulate && simulatePromptMessages.length > 0) {
            //simulatePromptMessages.shift();
            response = {
                choices: [
                    {
                        message: {
                        role: 'assistant',
                        content: '```json\n' +
                            '{\n' +
                            `  "description": "Click the 'word abonnee' button to potentially navigate to a login or registration page",\n` +
                            '  "action": {\n' +
                            `    "actionType": "${actionResults.length % 2 ? "scroll" : "click"}",\n` +
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
        }
        else {
            response = await openai.chat.completions.create({
                messages: temp_prompt_messages,
                max_tokens: 300,
                model: openaiModel,
            });    
        }

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
        actionResults.push(await action.perform(page, jsonObject.action));

        write_html (args.filename, prompt_messages, screenshots, actionResults);
        if (args.store) {
            write_prompts (args.store, prompt_messages);
        }

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


