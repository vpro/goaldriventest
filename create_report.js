const actions = require('./actions');
const { DateTime } = require('luxon');
const fs = require('fs');

// Todo: make the arguments for this function more generic

function create_report (filename, prompt_messages, screenshots, actionResults, args, startime) 
{
    if (screenshots.length !== actionResults.length + 1) {
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
            .step {
                border: 1px solid #ddd;
                padding: 15px;
                margin: 10px;
                border-radius: 5px;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
                display: flex;
            }
            .step-count {
                width: 100%;
            }
            .intro {
                border: 1px solid #ddd;
                padding: 15px;
                margin: 10px;
                border-radius: 5px;
                box-shadow: 0 0 10px rgba(0,0,0,0.1);
                width: 50%;
            }
            .intro h1 {
                color: #333;
            }
			.image {
				margin: 10px;
				cursor: pointer;
			}
			img {
				max-width: 100%;
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
                width: 50%;
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

    html_content += `
    <div class="step">
        <div class="intro">
            <h1>Goal: ${args.goal}</h1>
            <p>URL: ${args.url}</p>
            <p>Start time: ${startime.toFormat('yyyy-LL-dd HH:mm:ss')}</p>
            <p>End time: ${DateTime.now().toFormat('yyyy-LL-dd HH:mm:ss')}</p>
            <p>Number of steps: ${actionResults.length}</p>
            <p>Goal achieved: ${actionResults.length > 0 && actionResults[actionResults.length - 1].achieved ? 'Yes' : 'No'}</p>
            <p>Browser: ${args.browser}</p>
        </div>
        <div class="image" onclick="toggleFullscreen(this)">
            <img src="data:image/png;base64,${screenshots[0]}" alt="Starting screenshot" />
        </div>
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

			html_content += `
            <div class="step-count">
                <h2>Step ${step + 1}</h2>
            </step-count>
            <div class="step">
                 <div class="action-card">
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
                </div>
                <div class="image" onclick="toggleFullscreen(this)">
                    <img src="data:image/png;base64,${screenshots[step + 1]}" alt="Screenshot ${step + 1}" />
                </div>
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

module.exports = { create_report }
