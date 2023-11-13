window.elementInfo = getVisibleAndClickableElements ();
//return JSON.stringify(elementInfo);

function getVisibleAndClickableElements () { 
    // Collect all clickable elememts, also the ones in the shadowdoms
    const selector = 'a, button, use, select, input, [role="button"], [tabindex]:not([tabindex="-1"]';
    const clickableElements = querySelectorDeep(selector);  

    // get rid of cookie consent first
    const cookieConsent = document.getElementById("ccm_notification_host");
    if (cookieConsent && window.getComputedStyle(cookieConsent).visibility !== 'hidden' && cookieConsent.shadowRoot) {
        //cookieConsent.shadowRoot.replaceChildren("");
    }

    // Maak een lijst van objecten met de coördinaten en het element, clear any old ones first if present 
    const elementsCoordinates = [];
    let attachElement = document.getElementById("test_all_numbers");
    if (!attachElement) {
        attachElement = document.body.appendChild(document.createElement('div'));
        attachElement.id = "test_all_numbers";
        attachElement.style.position = 'fixed';
        attachElement.style.left = 0; 
        attachElement.style.top = 0; 
        attachElement.style.zIndex = '99999999999';
    }
    else {
        attachElement.replaceChildren("");
    }

    let screenRect = {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight
    }
 
    clickableElements.forEach((element, index) => {
        let rect = clipRect (getVisibleRect (element), screenRect);
        // Check if the element is visible and not behind something else
        if (rect.width > 0 && rect.height > 0) {
            // console.log(index, rect, elementsCoordinates.length, element);

            elementsCoordinates.push({
                element: element,
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            });

            // Create a div with the number of the element
            const numberDiv = document.createElement('div');
            numberDiv.innerText = elementsCoordinates.length - 1;
            numberDiv.style.position = 'absolute';
            numberDiv.style.top = (rect.y + rect.height*0 - 5) + 'px';
            numberDiv.style.left = (rect.x + rect.width / 8) + 'px';
            numberDiv.style.width = 30;
            numberDiv.style.height = 30;
            numberDiv.style.display = 'flex';
            numberDiv.style.justifyContent = 'center';
            numberDiv.style.alignItems = 'center';
            numberDiv.style.backgroundColor = 'rgba(255, 255, 0, 0.85)';
            numberDiv.style.borderRadius = '100%';
            numberDiv.style.fontSize = '16px';
            numberDiv.style.fontWeight = 'bold';
            numberDiv.style.color = 'black';
            numberDiv.style.zIndex = '99999999999';
            numberDiv.style.pointerEvents = 'none';

            attachElement.appendChild(numberDiv);
        }
    });
    // console.log("Return the elementCoordinates", elementsCoordinates, elementsCoordinates.length);
    return elementsCoordinates;
}

// query elements even deeply within shadow doms. e.g.:
// ts-app::shadow paper-textarea::shadow paper-input-container
function querySelectorDeep(selector, rootNode=document.body) {
    const elements = [];
    
    const traverser = node => {
        // 1. decline all nodes that are not elements
        if(node.nodeType !== Node.ELEMENT_NODE) {
            return elements;
        }
        
        // 2. add the node to the array, if it matches the selector
        if(node.matches(selector)) {
            elements.push(node);
        }
        
        // 3. loop through the children
        const children = node.children;
        if(children.length) {
            for(const child of children) {
                traverser(child);
            }
        }
        
        // 4. check for shadow DOM, and loop through it's children
        const shadowRoot = node.shadowRoot;
        if(shadowRoot) {
            const shadowChildren = shadowRoot.children;
            for(const shadowChild of shadowChildren) {
                traverser(shadowChild)
            }
        }
    }
    
    if (rootNode) {
        traverser(rootNode);
    }
    
    return elements;
}


function elementFromPointDeep(x, y) {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
        const inner = element.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === element) break;
        element = inner;
    }
    return element;
}

function isVisible(element) {
    if (!(element instanceof Element)) throw Error('DomUtil: elem is not an element.');

    // You would expect line below would suffice... not, we are going to do it the hard way
    // return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible') return false;

    const rect = element.getBoundingClientRect();
    if (element.offsetWidth + element.offsetHeight + rect.height + rect.width === 0) {
        return false;
    }

    // Check if the element is completely obscured by others
    const points = [
        { x: rect.left, y: rect.top },
        { x: rect.left + rect.width / 2, y: rect.top },
        { x: rect.right, y: rect.top },
        { x: rect.left, y: rect.top + rect.height / 2 },
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        { x: rect.right, y: rect.top + rect.height / 2 },
        { x: rect.left, y: rect.bottom },
        { x: rect.left + rect.width / 2, y: rect.bottom },
        { x: rect.right, y: rect.bottom }
    ];
    
    for (const point of points) {
        const topElement = elementFromPointDeep(point.x, point.y);
        if (element.contains(topElement) || topElement === element) {
            return true; // At least one point of the element is unobscured by another element
        }
    }
    return false; // No points are obscured
}

function getVisibleRect(element) {
    
    if (!(element instanceof Element)) throw Error('DomUtil: elem is not an element.');

    let visibleRect = { x: 0, y: 0, width: 0, height: 0 };
 
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible') return visibleRect;

    const boundingRect = element.getBoundingClientRect();
    if (element.offsetWidth + element.offsetHeight + boundingRect.height + boundingRect.width === 0) {
        return visibleRect;
    }

    // Check if the element is completely obscured by others
    let points = [
        { x: boundingRect.left, y: boundingRect.top },
        { x: boundingRect.left + boundingRect.width / 2, y: boundingRect.top },
        { x: boundingRect.right, y: boundingRect.top },
        { x: boundingRect.left, y: boundingRect.top + boundingRect.height / 2 },
        { x: boundingRect.left + boundingRect.width / 2, y: boundingRect.top + boundingRect.height / 2 },
        { x: boundingRect.right, y: boundingRect.top + boundingRect.height / 2 },
        { x: boundingRect.left, y: boundingRect.bottom },
        { x: boundingRect.left + boundingRect.width / 2, y: boundingRect.bottom },
        { x: boundingRect.right, y: boundingRect.bottom }
    ];
    
    let isVisible = false;
    let minX = Number.MAX_SAFE_INTEGER;
    let minY = Number.MAX_SAFE_INTEGER;
    let maxX = Number.MIN_SAFE_INTEGER;
    let maxY = Number.MIN_SAFE_INTEGER;

    for (const point of points) {
        const topElement = elementFromPointDeep(point.x, point.y);
        if (element.contains(topElement) || topElement === element) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
            isVisible = true;
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
    // Ensure rectB's left side is within rectA
    rectToClip.x = Math.max(rectToClip.x, clippingRect.x);

    // Ensure rectB's top side is within rectA
    rectToClip.y = Math.max(rectToClip.y, clippingRect.y);

    // Ensure rectB's right side is within rectA
    rectToClip.width = Math.min(rectToClip.x + rectToClip.width, clippingRect.x + clippingRect.width) - rectToClip.x;

    // Ensure rectB's bottom side is within rectA
    rectToClip.height = Math.min(rectToClip.y + rectToClip.height, clippingRect.y + clippingRect.height) - rectToClip.y;

    // Ensure width and height are not negative after clipping
    rectToClip.width = Math.max(rectToClip.width, 0);
    rectToClip.height = Math.max(rectToClip.height, 0);

    return rectToClip;
}

function markClickableElement(elementIndex) {
    const attachElement = document.getElementById("test_all_numbers");
    if (elementIndex >= 0 && elementIndex < attachElement.length) {
        attachElement.childNodes(elementIndex).style.backgroundColor = 'rgba(255, 0, 0, 0.85)';
        clickableElements[elementIndex].element.style.backgroundColor = 'rgba(255, 0, 0, 0.85)';
    }
}