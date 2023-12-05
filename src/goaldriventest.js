// Copyright (c) Mathijn Elhorst.
// Licensed under the MIT license.
// Main file for the goal driven test
// This file contains the main function that runs the test

"use strict";

const fs = require("fs");
const axios = require("axios");
const puppeteer = require("puppeteer");
const sharp = require("sharp");
const { ArgumentParser } = require("argparse");
const { DateTime } = require("luxon");
const actions = require("./actions");
const getSystemPrompt = require("./system_prompt");
const { installMouseHelper } = require("./mouse_helper");
const { createReport } = require("./create_report");
const { OpenAIClient, AIPlaybackClient } = require("./ai_client");

// Set up OpenAI
const { OPENAI_API_KEY } = process.env;
const OPENAI_MAX_TOKENS = 350;
const OPENAI_MODEL = "gpt-4-vision-preview";

// Other setup
const MAX_STEPS = 5;
const BROWSER_DELAY_MSECS = 4000; // Time in milliseconds
const SCREENSHOT_MAXSIZE = { width: 1024, height: 1024 };

// Temporary settings until OpenAI can give back x,y positions of elements
const USE_ELEMENT_NUMBERS_FOR_CLICK = true;
const ELEMENT_NUMBERS_SELECTOR =
  'a, button, use, select, input, [role="button"], [tabindex]:not([tabindex="-1"]';

async function getScreenshot(page, markClickableObjects = true) {
  if (markClickableObjects) {
    // Label all clickable elements
    let scriptContents = fs.readFileSync(
      "src/mark_clickable_objects.js",
      "utf8",
    );
    scriptContents += `\nwindow.goal_driven_test_element_override_selector='${ELEMENT_NUMBERS_SELECTOR}';\n`;
    await page.evaluate(scriptContents);
  }

  // make the mouse visible
  // installMouseHelper(page);

  // Make a screenshot
  const screenshotBinary = await page.screenshot({
    type: "jpeg",
    encoding: "binary",
  });
  if (screenshotBinary === undefined) {
    throw new Error("Could not create screenshot");
  }

  const screenshotBuf = await sharp(screenshotBinary)
    .resize(SCREENSHOT_MAXSIZE.width, SCREENSHOT_MAXSIZE.height, {
      fit: "inside",
    })
    .jpeg({ quality: 100 })
    .toBuffer();

  return screenshotBuf.toString("base64");
}

// Main function
async function main() {
  let browser;
  try {
    // Argument parsing
    const parser = new ArgumentParser();
    parser.add_argument("url", { help: "Starting URL" });
    parser.add_argument("goal", { help: "Goal of the test" });
    parser.add_argument("filename", {
      help: "Filename to store the results of the test",
    });

    parser.add_argument("-b", "--browser", {
      default: "chrome",
      help: "Browser to use (firefox or chrome)",
    });
    parser.add_argument("--playback", {
      help: "playback the test run from the json file from a previous recording",
    });
    parser.add_argument("--store", {
      help: "Save the test run to json file for use by playback",
    });
    parser.add_argument("--noheadless", {
      action: "store_true",
      help: "Don't use a headless browser",
    });
    parser.add_argument("--stealth", {
      action: "store_true",
      help: "Add some HTTP headers to hide puppeteer usage",
    });
    parser.add_argument("-m", "--maxsteps", {
      default: MAX_STEPS,
      help: "The maximum number of steps to take",
    });
    parser.add_argument("-e", "--emulate", {
      default: "iPad Mini landscape",
      help: "Emulate device",
    });
    parser.add_argument("-l", "--list", {
      action: "store_true",
      help: "List possible devices",
    });
    parser.add_argument("-V", "--version", {
      help: "version number",
      action: "version",
      version: "v0.1.0",
    });

    const args = parser.parse_args();
    const startime = DateTime.now();

    if (args.list) {
      console.log(
        `Possible devices to simulate:\n${Object.keys(
          puppeteer.KnownDevices,
        ).join("\n")}`,
      );

      return;
    }

    // Init the API
    let aiAPI;
    if (args.playback) {
      aiAPI = new AIPlaybackClient(args.playback);
      console.log(
        `Playback from file: ${
          args.playback
        } steps: ${aiAPI.getNumberOfSteps()}`,
      );
      if (args.maxsteps > aiAPI.getNumberOfSteps()) {
        console.log(
          `Info: maxsteps is larger than the number of steps in the playback file, setting maxsteps to ${aiAPI.getNumberOfSteps()}`,
        );
        args.maxsteps = aiAPI.getNumberOfSteps();
      }
    } else {
      aiAPI = new OpenAIClient(OPENAI_API_KEY, OPENAI_MODEL, OPENAI_MAX_TOKENS);
      console.log("Using the OpenAI API");
    }
    aiAPI.addSystemPrompt(getSystemPrompt(args.goal, actions));

    // Init puppeteer
    if (args.browser === "chrome") {
      browser = await puppeteer.launch({
        headless: args.noheadless ? false : "new",
        args: ["--no-sandbox"],
      });
      /* for docker browser = await puppeteer.launch({
                executablePath: '/usr/bin/google-chrome',
                args: [
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    '--disable-setuid-sandbox',
                    '--no-sandbox'
                ]
            }); */
    } else if (args.browser === "firefox") {
      browser = await puppeteer.launch({
        headless: !args.noheadless,
        args: ["--no-sandbox"],
        product: "firefox",
      });
    } else {
      throw new Error("Browser not recognized");
    }

    const page = await browser.newPage();
    await page.emulate(puppeteer.KnownDevices[args.emulate]);
    if (args.stealth) {
      /* add for sites that block headless browsers */
      await page.setExtraHTTPHeaders({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
        "upgrade-insecure-requests": "1",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en-US,en;q=0.9,en;q=0.8",
      });
    }
    const navigateResult = await page.goto(args.url);
    if (!navigateResult.ok()) {
      throw new Error("Could not navigate to URL");
    }

    // All set up, let's go!
    console.log("Starting test run\n");
    console.log(`Starting URL: ${args.url}`);
    console.log(`Goal: "${args.goal}"`);
    console.log(`Max steps: ${args.maxsteps}`);

    const screenshots = [];
    const actionResults = [];

    await new Promise((resolve) => setTimeout(resolve, BROWSER_DELAY_MSECS));
    screenshots.push(await getScreenshot(page, USE_ELEMENT_NUMBERS_FOR_CLICK));

    // Our testing loop
    let step = 0;
    let achieved = false;

    while (step < args.maxsteps && !achieved) {
      console.log(`Step ${step + 1}`);

      const prompt = {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is step ${step}. Continue with this image, what's your next action? The url is ${page.url()}`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${screenshots[step]}`,
            },
          },
        ],
      };
      const response = await aiAPI.processPrompt(prompt);

      if (!response || response.content?.length === 0) {
        throw new Error("No response from API");
      }
      const content = response.content[0];
      if (
        content.type !== "text" ||
        content.text === undefined ||
        content.text.includes("```json") === false
      ) {
        throw new Error(
          `API response doesn't contain JSON, response: ${JSON.stringify(
            content,
            null,
            4,
          )}`,
        );
      }

      const jsonString = content.text
        .replace("```json\n", "")
        .replace("\n```", "");
      const jsonObject = JSON.parse(jsonString);

      if (jsonObject.achieved === false) {
        if (
          jsonObject.action === undefined ||
          jsonObject.action.actionType === undefined
        ) {
          throw new Error("No valid action defined");
        }

        // Perform the action
        const action = actions[jsonObject.action.actionType];
        if (!action) {
          throw new Error("Action not recognized");
        }
        const actionResult = await action.perform(page, jsonObject.action);
        actionResults.push(actionResult);
        console.log(`Taking action: ${actionResult}`);
        await new Promise((resolve) =>
          setTimeout(resolve, BROWSER_DELAY_MSECS),
        );
      } else {
        achieved = true;
      }

      screenshots.push(
        await getScreenshot(page, USE_ELEMENT_NUMBERS_FOR_CLICK),
      );

      if (args.store && args.store != args.playback) {
        aiAPI.writePromptHistoryToFile(args.store);
      }

      createReport(
        args.filename,
        aiAPI.getPromptHistory(),
        screenshots,
        actionResults,
        args,
        startime,
      );

      step += 1;
    }

    if (achieved) {
      console.log(`Goal achieved in ${step} ${step > 1 ? "steps" : "step"}!`);
      process.exitCode = 0;
    } else {
      process.exitCode = 1;
      if (step > args.maxsteps) {
        console.log(`Maximum number of steps (${args.maxsteps}) reached.`);
      }
      console.log("Goal not achieved.");
    }
  } catch (error) {
    console.log(error);
  } finally {
    // Close browser
    if (browser) {
      await browser.close();
    }
  }
}

// Run the main function
main().catch(console.error);
