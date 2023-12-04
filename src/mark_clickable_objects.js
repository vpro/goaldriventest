// Copyright (c) Mathijn Elhorst.
// Licensed under the MIT license.
//
// This script will run in the browser to mark all clickable items with a number in a yellow circle.
// It will also store an array of objects with the x,y,width and height of the element that will be used
// to determine a x,y position of the element when the AI is running.

"use strict";

window.goal_driven_test_element_info = getVisibleAndClickableElements();

/**
 * This functions determines all visible and clickable elements on the page and
 * marks them with a number. It is needed to determine x,y positions of elements
 * because the AI is currently not giving accurate x,y positions of elements.
 *
 * @returns an array of objects with visible x,y,width and height of the element and the element itself
 */
function getVisibleAndClickableElements() {
  // Collect all clickable elememts, also the ones in the shadowdoms
  let selector =
    'a, button, use, select, input, [role="button"], [tabindex]:not([tabindex="-1"]';
  if (window.goal_driven_test_element_override_selector) {
    selector = window.goal_driven_test_element_override_selector;
  }
  const clickableElements = querySelectorDeep(selector);

  // get rid of cookie consent first
  const cookieConsent = document.getElementById("ccm_notification_host");
  if (
    cookieConsent &&
    window.getComputedStyle(cookieConsent).visibility !== "hidden" &&
    cookieConsent.shadowRoot
  ) {
    // cookieConsent.shadowRoot.replaceChildren("");
  }

  // Maak een lijst van objecten met de coördinaten en het element, clear any old ones first if present
  const elementsCoordinates = [];
  let attachElement = document.getElementById("goal_driven_test_all_numbers");
  if (!attachElement) {
    attachElement = document.body.appendChild(document.createElement("div"));
    attachElement.id = "goal_driven_test_all_numbers";
    attachElement.style.position = "fixed";
    attachElement.style.left = 0;
    attachElement.style.top = 0;
    attachElement.style.zIndex = "99999999999";
  } else {
    attachElement.replaceChildren("");
  }

  const screenRect = {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };

  const styleElement = document.createElement("style");
  styleElement.innerHTML = `
        .goal_driven_test_all_numbers_number {
            position: absolute;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: rgba(255, 255, 0, 0.9);
            border-radius: 50%;
            // border: 1px solid black; 
            box-shadow: 0 0 0 1px white;
            border-radius: 50%;   
            padding: 2px;
            font-size: 13px;
            font-weight: bold;
            color: black;
            z-index: 99999999999;
            pointer-events: none;
        }
    `;
  attachElement.appendChild(styleElement);

  clickableElements.forEach((element, index) => {
    const rect = clipRect(getVisibleRect(element), screenRect);
    // Check if the element is visible and not behind something else
    if (rect.width > 0 && rect.height > 0) {
      elementsCoordinates.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });

      // Create a div with the number of the element
      const numberDiv = document.createElement("div");
      numberDiv.className = "goal_driven_test_all_numbers_number";
      numberDiv.innerText = elementsCoordinates.length - 1;
      numberDiv.style.top = `${rect.y + rect.height * 0 - 5}px`;
      numberDiv.style.left = `${rect.x + rect.width * 0.4}px`;

      attachElement.appendChild(numberDiv);

      /* Debug: Show the calculated visible rectangle of the element
            const elementRectangle = document.createElement('div');
            elementRectangle.style.position = 'absolute';
            elementRectangle.style.top = rect.y + 'px';
            elementRectangle.style.left = rect.x + 'px';
            elementRectangle.style.width = rect.width + 'px';
            elementRectangle.style.height = rect.height + 'px';
            elementRectangle.style.display = 'flex';
            elementRectangle.style.backgroundColor = 'rgba(255, 0, 0, 0.25)';
            elementRectangle.style.borderRadius = '2px';
            elementRectangle.style.zIndex = '99999999999';
            elementRectangle.style.pointerEvents = 'none';

            attachElement.appendChild(elementRectangle); */
    }
  });

  return elementsCoordinates;
}

// query elements even deeply within shadow doms
function querySelectorDeep(selector, rootNode = document.body) {
  const elements = [];

  const traverser = (node) => {
    // 1. decline all nodes that are not elements
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return elements;
    }

    // 2. add the node to the array, if it matches the selector
    if (node.matches(selector)) {
      elements.push(node);
    }

    // 3. loop through the children
    const { children } = node;
    if (children.length) {
      for (const child of children) {
        traverser(child);
      }
    }

    // 4. check for shadow DOM, and loop through it's children
    const { shadowRoot } = node;
    if (shadowRoot) {
      const shadowChildren = shadowRoot.children;
      for (const shadowChild of shadowChildren) {
        traverser(shadowChild);
      }
    }
  };

  if (rootNode) {
    traverser(rootNode);
  }

  return elements;
}

/**
 * Function that returns the element at the given x,y coordinates, also searches the shadow dom
 * @param {*} x - x coordinate to search for
 * @param {*} y - y coordinate to search for
 * @returns element at the given x,y coordinates
 */
function elementFromPointDeep(x, y) {
  const depth = 0;
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) {
      break;
    }
    element = inner;
  }

  return element;
}

/**
 * Function determines an approximation of the visible rectangle of an element that's not obscured by other elements
 * @param {*} element
 * @returns the visible rectangle of an element that's not obscured by other elements { x, y, width, height }
 */
function getVisibleRect(element) {
  if (!(element instanceof Element)) {
    throw Error("DomUtil: elem is not an element.");
  }

  const visibleRect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility !== "visible") {
    return visibleRect;
  }

  const boundingRect = element.getBoundingClientRect();
  if (
    element.offsetWidth +
      element.offsetHeight +
      boundingRect.height +
      boundingRect.width ===
    0
  ) {
    return visibleRect;
  }

  let isVisible = false;
  let minX = Number.MAX_SAFE_INTEGER;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = Number.MIN_SAFE_INTEGER;
  let maxY = Number.MIN_SAFE_INTEGER;

  const divider = 10;
  for (let x = 0; x < divider; ++x) {
    for (let y = 0; y < divider; ++y) {
      const point = {
        x: boundingRect.left + (boundingRect.width * x) / divider,
        y: boundingRect.top + (boundingRect.height * y) / divider,
      };
      const topElement = elementFromPointDeep(point.x, point.y);

      if (
        topElement &&
        (isDeepDescendant(element, topElement) || topElement === element)
      ) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
        isVisible = true;
      }
    }
  }

  if (isVisible) {
    visibleRect.x = minX;
    visibleRect.y = minY;
    visibleRect.width = Math.max(1, maxX - minX);
    visibleRect.height = Math.max(1, maxY - minY);
  }

  return visibleRect;
}

function doRectsOverlap(rect1, rect2) {
  return !(
    rect1.right < rect2.left ||
    rect1.left > rect2.right ||
    rect1.bottom < rect2.top ||
    rect1.top > rect2.bottom
  );
}

function clipRect(rectToClip, clippingRect) {
  const result = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  result.x = Math.max(rectToClip.x, clippingRect.x);
  result.y = Math.max(rectToClip.y, clippingRect.y);
  result.width =
    Math.min(
      rectToClip.x + rectToClip.width,
      clippingRect.x + clippingRect.width,
    ) - result.x;
  result.height =
    Math.min(
      rectToClip.y + rectToClip.height,
      clippingRect.y + clippingRect.height,
    ) - result.y;

  // Ensure width and height are not negative after clipping
  result.width = Math.max(result.width, 0);
  result.height = Math.max(result.height, 0);

  return result;
}

/**
 * Function determines if an element is a deep descendant of another element (also in shadow doms)
 * @param {*} parent
 * @param {*} child
 * @returns true if the child is a deep descendant of the parent, false otherwise
 */

function isDeepDescendant(parent, child) {
  let node = child.parentNode ? child.parentNode : child.host;
  while (node !== null && node !== undefined) {
    if (node === parent || node.shadowRoot == parent) {
      return true;
    }
    node = node.parentNode ? node.parentNode : node.host;
  }

  return false;
}
