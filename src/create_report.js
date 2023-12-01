// Copyright (c) Mathijn Elhorst.
// Licensed under the MIT license.
// Contains the function to create a testing report in a fully self contained HTML file

'use strict';

const { DateTime } = require( 'luxon' );
const fs = require( 'fs' );
const actions = require( './actions' );

function contentToJson( content ) {
    return JSON.parse( content.replace( '```json\n', '' ).replace( '\n```', '' ) );
}

// Todo: make the arguments for this function a little less ugly
function createReport ( filename, promptMessages, screenshots, actionResults, args, startime ) {
    let htmlContent = `<!DOCTYPE html>
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

    htmlContent += `
    <div class="step">
        <div class="intro">
            <h1>Goal:</h1>
            <p><strong>${args.goal}</strong></p>
            <p>URL: <a href="${args.url}">${args.url}</a></p>
            <p>Start time: ${startime.toFormat( 'yyyy-LL-dd HH:mm:ss' )}</p>
            <p>End time: ${DateTime.now().toFormat( 'yyyy-LL-dd HH:mm:ss' )}</p>
            <p>Number of steps: ${screenshots.length - 1}</p>
            <p>Goal achieved: ${promptMessages.length > 0 && contentToJson( promptMessages[promptMessages.length - 1].content[0].text ).achieved ? 'Yes' : 'No'}</p>
            <p>Browser: ${args.browser}</p>
            <p>Device: ${args.emulate}</p>
        </div>
        <div class="image" onclick="toggleFullscreen(this)">
            <img src="data:image/png;base64,${screenshots[0]}" alt="Starting screenshot" />
        </div>
    </div>`;

    let step = 0;
    for ( let i = 0; i < promptMessages.length; i++ ) {
        const promptMessage = promptMessages[i];

        if ( promptMessage.role === 'assistant' ) {
            const jsonData = contentToJson( promptMessage.content[0].text );
            let nextJsonData;
            for ( let j = i + 1; j < promptMessages.length; j++ ) {
                if ( promptMessages[j].role === 'assistant' ) {
                    nextJsonData = contentToJson( promptMessages[j].content[0].text );
                    break;
                }
            }
            const actionPayload = jsonData.action;
            let actionHtml = '';
            if ( actionPayload?.actionType ) {
                const action = actions[actionPayload.actionType];
                if ( !action ) {
                    throw new Error( `Action ${actionPayload.actionType} not recognized` );
                }
                actionHtml = `<div class="action">
                    ${action.getDescriptionHTML( actionPayload )}
                    <p><b>Action result:</b> <span id="actionResult">${actionResults[step]}</span></p>                
                    </div>`;
            }

            htmlContent += `
            <div class="step-count">
                <h2>Step ${step + 1}</h2>
            </step-count>
            <div class="step">
                 <div class="action-card">                    
                    ${actionHtml}
                    <p><b>Description:</b> <span id="description">${jsonData.description}</span></p>`;

            if ( nextJsonData ) {
                if ( nextJsonData.previousExpectation != jsonData.expectation ) {
                    console.log( 'Warning: previousExpectation is not the same as the current expectation' );
                }
                htmlContent
                    += `<p/>
                    <p><b>Url:</b> <span id="url"><a href="${nextJsonData.url}">${nextJsonData.url}</a></span></p>
                    <p><b>Expectation:</b> <span id="${nextJsonData.expectationSatisfied ? 'expectation-success' : 'expectation-failed'}">${nextJsonData.previousExpectation}</span></p>
                    <div class="frustration-level">
                        <b>Frustration Level:</b>
                        <my-dial level="${nextJsonData.frustrationLevel}"></my-dial>
                        <span id="frustrationLevel">${nextJsonData.frustrationLevel}</span>
                    </div>
                    <p><b>Frustration Level Reason:</b> <span id="frustrationLevelReason">${nextJsonData.frustrationLevelReason}.</span></p>`;
            } else {
                // This is the last step. We don't know the result of the expectation as we didn't ask the AI, except if the goal was achieved
                htmlContent
                    += `<p/>
                    <p><b>Expectation:</b> <span id=${jsonData.achieved ? 'expectation-success' : 'expectation'}}">${jsonData.expectation}</span></p>`;
                if ( jsonData.achieved ) {
                    htmlContent += '<p><b>Goal achieved!</b> 🎉</p>';
                }
            }
            htmlContent += `
                </div>
                <div class="image" onclick="toggleFullscreen(this)">
                    <img src="data:image/png;base64,${screenshots[step + 1]}" alt="Screenshot ${step + 1}" />
                </div>
            </div>`;

            // Debug only, marked with display: none in the style
            htmlContent += `<div class="json"><pre>{${JSON.stringify( jsonData, null, 4 )}}</pre></div>`;

            step += 1;
        }
    }

    htmlContent += `
		</div>
		<script>
			function toggleFullscreen(element) {
				element.classList.toggle('fullscreen');
			}
		</script>
	</body>
	</html>
	`;

    const file = fs.openSync( filename, 'w' );
    if ( file !== undefined ) {
        fs.writeSync( file, htmlContent );
        fs.closeSync( file );
    }
}

module.exports = { createReport };
