// Copyright (c) VPRO
// Licensed under the MIT license.
// Author: Mathijn Elhorst.
//
// Contains the function to create a testing report in a fully self contained HTML file

"use strict";

import fs from "fs";
import { DateTime } from "luxon";
import { actionFactoryInstance } from "./BrowserActions.js";
import { Prompt } from "./AIClient.js";

// Todo: make this function check for the correct format 
// Function that takes the text content of a prompt and returns the json inside. Can throw an error if the format is not correct
function contentToJson(prompt: Prompt): any {
  let json;
  if (prompt?.content[0]?.text) {
    json = JSON.parse(prompt.content[0].text.replace("```json\n", "").replace("\n```", ""));
  }
  return json;
}

function contentToScreenshot(prompt: Prompt): string {
  let screenshot = "";
  if (prompt?.content[1]?.image_url) {
    screenshot = prompt.content[1].image_url.url.replace("data:image/png;base64,", "").replace("data:image/jpeg;base64,", "");
  }
  return screenshot;
}

// Todo: make the arguments and the implementation of this function less ugly and with more checks
function createReport(
  filename: string,
  promptMessages: Prompt[],
  actionResults: string[],
  screenshots: string[],
  args: any,
  startime: DateTime,
): void {

  let jsonActions = promptMessages.flatMap(prompt => prompt.role === "assistant" ? [contentToJson(prompt)] : []);

  console.log("jsonActions", jsonActions.length);
  console.log("screenshots", screenshots.length);
  console.log("actionResults", actionResults.length);

  if (jsonActions.length < 1) {
    throw new Error("Internal error: No actions found");
  }
  if (jsonActions.length < actionResults.length) {
    throw new Error("Internal error: Number of actions and number of action results do not match");
  }
  if (screenshots.length < jsonActions.length) {
    throw new Error("Internal error: Number of screenshots unexpected");
  }
  
  let htmlContent = `
  <html>
  ${getHeader()}
  <body>
  <div class="container">`;

  // Introductory part
  htmlContent += `
    <div class="step">
        <div class="intro">
            <h1>Goal:</h1>
            <p><strong>${args.goal}</strong></p>
            <p>URL: <a href="${args.url}">${args.url}</a></p>
            <p>Start time: ${startime.toFormat("yyyy-LL-dd HH:mm:ss")}</p>
            <p>End time: ${DateTime.now().toFormat("yyyy-LL-dd HH:mm:ss")}</p>
            <p>Number of steps: ${jsonActions.length}</p>
            <p>Goal achieved: ${jsonActions[jsonActions.length - 1].achieved ? "Yes" : "No"}</p>
            <p>Browser: ${args.browser}</p>
            <p>Device: ${args.emulate}</p>
        </div>
        <div class="image" onclick="toggleFullscreen(this)">
            <img src="data:image/png;base64,${
              screenshots[0]
            }" alt="Starting screenshot" />
        </div>
    </div>`;

  jsonActions.forEach((jsonAction, step) => {
    let nextJsonAction = jsonActions[step + 1];
    htmlContent += getStepReport (step, jsonAction, nextJsonAction, actionResults[step], screenshots[step + 1]);
  });

  htmlContent += `
		</div>
	</body>
	</html>
	`;

  const file = fs.openSync(filename, "w");
  if (file !== undefined) {
    fs.writeSync(file, htmlContent);
    fs.closeSync(file);
  }
}

function getStepReport (step: number, stepJsonData: any, nextStepJsonData: any, actionResult: string, screenshot: string) : string {

  const actionPayload = stepJsonData.action;
  let actionHtml = "";
  if (actionPayload?.actionType) {
    const action = actionFactoryInstance.getAction(
      actionPayload.actionType,
    );
    if (!action) {
      throw new Error(`Action ${actionPayload.actionType} not recognized`);
    }
    actionHtml = `<div class="action">
                    ${action.getDescriptionHTML(actionPayload)}
                    <p><b>Action result:</b> <span id="actionResult">${
                      actionResult
                    }</span></p>                
                </div>`;
  }

  let htmlContent = `
        <div class="step-count">
            <h2>Step ${step + 1}</h2>
        </div>
        <div class="step">
             <div class="action-card">                    
                ${actionHtml}
                <p><b>Description:</b> <span id="description">${
                  stepJsonData.description
                }</span></p>`;

  if (nextStepJsonData) {
    htmlContent += `<p/>
                <p><b>Url:</b> 
                  <span id="url"><a href="${
                      nextStepJsonData.url
                    }">${nextStepJsonData.url}</a>
                  </span>
                </p>

                <p><b>Expectation:</b> 
                  <span id="${
                    nextStepJsonData.expectationSatisfied
                      ? "expectation-success"
                      : "expectation-failed"
                    }">
                    ${nextStepJsonData.previousExpectation}
                  </span>
                </p>

                <div class="frustration-level">
                    <b>Frustration Level:</b>
                    <my-dial level="${
                        nextStepJsonData.frustrationLevel
                      }">
                    </my-dial>
                    <span id="frustrationLevel">${
                        nextStepJsonData.frustrationLevel
                      }
                    </span>
                </div>

                <p><b>Frustration Level Reason:</b> <span id="frustrationLevelReason">${
                    nextStepJsonData.frustrationLevelReason
                  }.</span>
                </p>`;
  } else {
    // This is the last step. We don't know the result of the expectation as we didn't ask the AI, except if the goal was achieved
    htmlContent += `
                <p/>
                <p><b>Expectation:</b> <span id=${
                    stepJsonData.achieved ? "expectation-success" : "expectation"
                  }}">${stepJsonData.expectation}</span>
                </p>`;
    if (stepJsonData.achieved) {
      htmlContent += "<p><b>Goal achieved!</b> 🎉</p>";
    }
  }

  htmlContent += `
            </div>
            <div class="image" onclick="toggleFullscreen(this)">
                <img src="data:image/png;base64,${
                  screenshot
                }" alt="Screenshot ${step + 1}" />
            </div>
        </div>`;

  // Debug only, marked with display: none in the style
  htmlContent += `<div class="json"><pre>{${JSON.stringify(
    stepJsonData,
    null,
    4,
  )}}</pre></div>`;

  return htmlContent;
}

function getHeader () : string {
  return `<!DOCTYPE html>
	<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Goaldriventest report</title>
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
                width: 100%;
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
				width: 100%;
				height: 100%;
                object-fit: contain;
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
                display: none;  // Debug only
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
                width: 100%;
            }
            .action-card h2 {
                color: #333;
            }
            #action-icon {
                font-size: 3em;
            }
            #expectation-success {
                color: green;
            }
            #expectation-failed {
                color: red;
            }            
		</style>

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
        
        // Toggle for the fullscreen images
        function toggleFullscreen(element) {
          element.classList.toggle('fullscreen');
        }
    </script>      
	</head> 
	`;
}

export { createReport };
