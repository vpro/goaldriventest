import json
import argparse
import openai
import requests
import os
import selenium
import time
import random
from selenium import webdriver
from datetime import datetime
from time import sleep

# OpenAI setup
openai.model="gpt-4"
openai.api_key = os.environ.get('OPENAI_API_KEY')
openai.organization = os.environ.get('OPENAI_ORGANIZATION')	

if not openai.api_key:
    raise ValueError("OpenAI API key (OPENAI_API_KEY) not found in environment variables")
if not openai.organization:
    raise ValueError("OpenAI organization (OPENAI_ORGANIZATION) not found in environment variables")

# Other setup
MAX_STEPS = 10
USE_ELEMENT_NUMBERS_FOR_CLICK = True

def upload_screenshot_and_get_response(screenshot_path):
	# with open(screenshot_path, "rb") as f:
	# 	response = await openai.File.acreate(
	# 		file=f,
	# 		user_provided_filename=screenshot_path,
	# 		purpose="answer"
	# 	)
	# 	print("Upload response: " + response)
	# elementNumber = random.randint(1, 15)
	elementNumber = int(input('Give the next elementNumber: '))
	return { "description": "Click on the button", "action": { "actionType": "click", "elementNumber": elementNumber, "x": 50, "y": 60 }, "expectation": "The button will be clicked", "step": 1, "achieved": False, "expectationSatisfied": False, "goal": "Click on the button}" }
	# return json.loads(response.choices[0].text)  # This assumes a text-based output, but you'd extract the relevant data as per your API setup


parser = argparse.ArgumentParser()
parser.add_argument("url", help="Starting URL")
parser.add_argument("goal", help="Goal of the test")
parser.add_argument("-b", "--browser", default="firefox", help="Browser to use (e.g., chrome)")
args = parser.parse_args()

if args.browser == "chrome":
	browser = webdriver.Chrome()
elif args.browser == "firefox":
	browser = webdriver.Firefox()
else:
	raise ValueError("Browser not recognized")

print(f"Loading {args.url}")
browser.get(args.url)
browser.implicitly_wait(10)  # wait for the page to load, improve!
sleep (5)

# We want to inject a script into the page that marks all clickable objects
# and returns a JSON structure with the coordinates of the clickable objects
# and their type (e.g., button, link, etc.)
# We then use that information to determine the next action to take
# and execute that action. As OpenAI doesn't give accurate coordinates for the elements we need to
# use the object number to determine the coordinates. We then use the coordinates to execute the action.
# We then repeat the process until the goal is achieved or we reach the maximum number of steps

try:
	with open('mark_clickable_objects.js', 'r') as file:
		scriptContents = file.read()
except Exception as e:
    raise Exception('Failed to read script file: {}'.format(e))

# Define the prompt
				   
prompt = """
You are going to test a website. You will be given a URL and a screenshot of the website with that URL.  
You try to understand the screenshots content and layout. From that you determine what the next logical 
action will be to reach the following goal: "%s". 

Possible actions are currently (more to be added later):
1. click
2. scroll

Every time you receive a screenshot of the website you determine your next action. 
You return a JSON structure that contains that action in the followung form:
- "description": A brief description of the action you are going to perform.
- "action": {
   "actionType": "click", #Identify the primary user action that can be taken on the screenshot (e.g., "click", "scroll", etc.),
   "elementNumber": 1, # The number of the element that is to be acted upon. The number is determined by the number in the yellow box around the element in the screenshot. 
    "x": The horizontal percentage coordinate where the action is to be taken, most normaly the center of the element
    "y": The vertical percentage coordinate where the action is to be taken, most normaly the center of the element
  }
- "expectation": Your prediction of what will happen when the action is taken. You are going to check this in the next step!
- "step": A number representing the order or sequence of the action in achieving the goal.
- "achieved": A boolean (true or false) indicating if the goal has been achieved or not. If so, action can be empty as this run is finished.
- "expectationSatisfied": A boolean (true or false) indicating if the previous action's expectation was met. Remember to evaluate the expectation of the previous step to carefully determine if it was met or not.
- "goal": Restate  the overarching goal you are trying to reach.
- "frustrationLevel": A number between 1 and 10 indicating how frustrated you are with the website. 1 is not frustrated at all, 10 is very frustrated. 
- "frustrationLevelReason": A brief description of where your frustrationLevel is coming from.

The action with actionType "click" should always contain actionType, elementNumber, x and y.
The action with actionType "scroll" should always contain actionType, elementNumber, x, y and scrollX and scrollY, the latter both in percentage of page height and width.

If there is any cookiebar present, please click it away first.
""" % (args.goal) 

prompt_messages = [ { "role": "system", "content": prompt } ]


print(f"Using the following prompt to initialize OpenAI: {prompt_messages}")

#response = openai.ChatCompletion.create(
#	messages=prompt_messages, 
#	model=openai.model)
#print(response)

step = 0
achieved = False

while not achieved and step < MAX_STEPS:
	print (f"Step {step} started")
	result_json_string = browser.execute_script(scriptContents)
	clickableElements = json.loads(result_json_string)
	print(clickableElements)	# Taking screenshot

	screenshot_path = f"screenshot_{step}.png"
	print("Taking screenshot step={step}")
	browser.save_screenshot(screenshot_path)

	# Upload to OpenAI and get JSON response
	response_json = upload_screenshot_and_get_response(screenshot_path)
	print (response_json)
	
	# Update variables based on the response
	achieved = response_json["achieved"]
	action = response_json["action"]
	
	if action == None:
		raise ValueError("No action returned")
	
	# Execute action

	# First convert percentage to pixel coordinates
	size = browser.get_window_size()
	elementIndex = action["elementNumber"] - 1
	if USE_ELEMENT_NUMBERS_FOR_CLICK and elementIndex >= 0 and elementIndex < len(clickableElements):
		clickableElement = clickableElements[elementIndex]
		print ("Action elementIndex: ", elementIndex, clickableElement)
		x = clickableElement["x"] + clickableElement["width"] / 2
		y = clickableElement["y"] + clickableElement["height"] / 2
	else:
		x = size["width"] * action["x"]	/ 100.0
		y = size["height"] * action["y"] / 100.0
	if action["actionType"] == "click":
		print ("Click: ", x, y)
		# why is elementFromPointDeep function not defined anymore???
		browser.execute_script("""
						 function elementFromPointDeep(x, y) { 
						 	let element = document.elementFromPoint(x, y); 
						 	while (element && element.shadowRoot) { 
						 	const inner = element.shadowRoot.elementFromPoint(x, y); 
						 	if (!inner) break; element = inner; } return element; 
						 } 
						 elementFromPointDeep(%d, %d)?.click()""" % (x, y))
		sleep(10)
	else:
		raise ValueError("Action not recognized")
		
	step += 1

browser.quit()

