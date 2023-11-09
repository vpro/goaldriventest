import json
import argparse
import openai
import requests
import os
import selenium
import time
import random
import base64
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.actions.wheel_input import ScrollOrigin

from datetime import datetime
from time import sleep

# OpenAI setup
openai.model="gpt-4-vision-preview"
openai.api_key = os.environ.get('OPENAI_API_KEY')
openai.organization = os.environ.get('OPENAI_ORGANIZATION')	

if not openai.api_key:
    raise ValueError("OpenAI API key (OPENAI_API_KEY) not found in environment variables")
if not openai.organization:
    raise ValueError("OpenAI organization (OPENAI_ORGANIZATION) not found in environment variables")

# Other setup
MAX_STEPS = 10
USE_ELEMENT_NUMBERS_FOR_CLICK = True

parser = argparse.ArgumentParser()
parser.add_argument("url", help="Starting URL")
parser.add_argument("goal", help="Goal of the test")
parser.add_argument("-b", "--browser", default="firefox", help="Browser to use (firefox or chrome)")
args = parser.parse_args()

if args.browser == "chrome":
	browser = webdriver.Chrome()
elif args.browser == "firefox":
	browser = webdriver.Firefox()
else:
	raise ValueError("Browser not recognized")

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
action will be to reach the given goal below.

Every time you receive a screenshot of the website you determine your next action. 
You return a JSON structure that contains that action in the following form, all other fields are required:
- "description": A brief description of the action you are going to perform.
- "action": # The action you are going to take.
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

The are two actions possible: "click" and "scroll".

The "action" structure with actionType "click" contains:
1. actionType (required)
2. elementNumber (required)
3. x and y (required)

The action with actionType "scroll" always contains:
1. actionType (required)
2. elementNumber (optional)
3. x and y (optional)
4. "direction" (required). can be "up", "down", "left", "right"
5. "distance" (required). The distance to scroll can be "little", "medium" or "far"
If either elementNumber or x,y are given, the scroll is tried on the element or coordinates. Otherwise the scroll is done on the whole page.

If there is any cookiebar present, please click it away first.

Please only output the JSON structure, nothing else.

Goal:
"%s" 

""" % (args.goal) 

prompt_messages = [ { "role": "system", "content": prompt } ]

#print(f"Using the following prompt to initialize OpenAI: {prompt}")


# Function to encode the image
def encode_image(image_path):
	with open(image_path, "rb") as image_file:
		return base64.b64encode(image_file.read()).decode('utf-8')
	
def upload_screenshot_and_get_response(screenshot_path):
	base64_image = encode_image(screenshot_path)

	temp_prompt_messages = prompt_messages.copy()

	temp_prompt_messages.append(
		{
			"role": "user",
			"content": [
				{
					"type": "text",
					"text": "Continue with this image, what's your next action?"
				},
				{
					"type": "image_url",
					"image_url": {
						"url": f"data:image/jpeg;base64,{base64_image}"
					}
				}
			]
		}
	)

	response = openai.ChatCompletion.create(
		messages=temp_prompt_messages, 
		model=openai.model,
		max_tokens=300)
	json_response = json.loads(response.choices[0].message.content.strip('```json').strip('```').strip())
	print ("\n\n------------------")
	print (response.choices[0].message.content.strip('```json').strip('```').strip())
	print ("\n####")
	print(json_response)
	print ("####")
#	prompt_messages.append({ "role": "user", "content": "Continue with this image, what's your next action?" })
#	prompt_messages.append({ "role": "assistent", "content": json_response["description"] })

	print("Prompts collected so far: ", prompt_messages)

	return json_response

	# print ("Give the JSON from OpenAI: ")
	# lines = []
	# while True:
	# 	line = input()
	# 	if not line:
	# 		break
	# 	lines.append(line)
	# multiline_input = '\n'.join(lines)
	# return json.loads(multiline_input)
	#return { "description": "Click on the button", "action": { "actionType": "scroll", "elementNumber": elementNumber, "x": 50, "y": 60 }, "expectation": "The button will be clicked", "step": 1, "achieved": False, "expectationSatisfied": False, "goal": "Click on the button}" }
	# return json.loads(response.choices[0].text)  # This assumes a text-based output, but you'd extract the relevant data as per your API setup


# Main loop
print(f"Loading {args.url}")
browser.get(args.url)
browser.implicitly_wait(10)  # wait at most 10 seconds for commands to return
sleep (5)

step = 0
achieved = False

while not achieved and step < MAX_STEPS:
	print (f"Step {step} started")
	result_json_string = browser.execute_script(scriptContents)
	clickableElements = json.loads(result_json_string)
	#print(clickableElements)	# Taking screenshot

	screenshot_path = f"screenshot_{step}.png"
	print(f"Taking screenshot step={step}")
	browser.save_screenshot(screenshot_path)

	# Upload to OpenAI and get JSON response
	response_json = upload_screenshot_and_get_response(screenshot_path)
	print (response_json)
	
	# Update variables based on the response
	achieved = response_json["achieved"]
	action = response_json["action"]
	
	if action == None or "actionType" not in action:
		raise ValueError("No action returned")
	
	# Execute action
	size = browser.get_window_size()

	# Get a x position, from center of element if correct elementNumber is given, otherwise from x, y coordinates
	x = -1
	y = -1
	elementIndex = -1
	if "elementNumber" in action:
		elementIndex = action["elementNumber"] - 1
	if USE_ELEMENT_NUMBERS_FOR_CLICK and elementIndex >= 0 and elementIndex < len(clickableElements):
		clickableElement = clickableElements[elementIndex]
		x = clickableElement["x"] + clickableElement["width"] / 2
		y = clickableElement["y"] + clickableElement["height"] / 2
		print ("Action x, y, elementIndex: ", x, y, elementIndex, clickableElement)
	else:
		if 'x' in action:
			x = size["width"] * action["x"]	/ 100.0
		if 'y' in action:	
			y = size["height"] * action["y"] / 100.0
		print ("Action x, y: ", x, y)

	if action["actionType"] == "click":
		# why is elementFromPointDeep function not defined anymore???
		# browser.execute_script("""
		#				 function elementFromPointDeep(x, y) { 
		#				 	let element = document.elementFromPoint(x, y); 
		#				 	while (element && element.shadowRoot) { 
		#				 	const inner = element.shadowRoot.elementFromPoint(x, y); 
		#				 	if (!inner) break; element = inner; } return element; 
		#				 } 
		#				 elementFromPointDeep(%d, %d)?.click()""" % (x, y))
		browserAction = ActionChains(browser)
		browserAction.move_by_offset(max(0, min(x, size["width"])), max(0, min(y, size["height"]))).click().perform()
		browserAction.reset_actions()

	elif action["actionType"] == "scroll":
		if "distance" in action:
			if action["distance"] == "little":
				distanceX = size["width"] / 4
				distanceY = size["height"] / 4
			elif action["distance"] == "medium":
				distanceX = size["width"] / 2
				distanceY = size["height"] / 2
			elif action["distance"] == "far":
				distanceX = size["width"]
				distanceY = size["height"]
			else:
				raise ValueError("Distance value little, medium or far should be given in scroll action")
		else:
			raise ValueError("Distance should be given in scroll action")
			
		scrollX = 0
		scrollY = 0
		if "direction" in action:
			if action["direction"] == "up":
				scrollY = -int(distanceY)
			elif action["direction"] == "down":
				scrollY = int(distanceY)
			elif action["direction"] == "left":
				scrollX = -int(distanceX)
			elif action["direction"] == "right":
				scrollX = int(distanceX)
			else:
				raise ValueError("Direction value up, down, left or right should be given in scroll action")
		else:
			raise ValueError("Direction should be given in scroll action")
		
		print ("Scrolling x, y, scrollX, scrollY: ", x, y, scrollX, scrollY)
		try:
			scroll_origin = ScrollOrigin.from_viewport(int(max(0, min(x, size["width"]))), int(max(0, min(y, size["height"]))))
			ActionChains(browser).scroll_from_origin(scroll_origin, scrollX, scrollY).perform()
			ActionChains(browser).reset_actions()
		except Exception as e:
			print("Scrolling failed: ", e)

	else:
		raise ValueError("Action not recognized")
		
	# wait for action to complete
	sleep(5)	

	step += 1

browser.quit()
