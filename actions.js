class Action {
    constructor(actionType) {
        this.actionType = actionType;
    }

    async perform(page, actionPayload) { // returns "info about action"
        throw new Error('Perform method must be implemented by subclasses');
    }

    getPromptInfo() {
        throw new Error('getPromptInfo method must be implemented by subclasses');
    }

    getDescriptionHTML(actionPayload) {
        throw new Error('getDescriptionHTML method must be implemented by subclasses');
    }

    // Helper functions
    async getElementInfo(page, actionPayload) {
        if (actionPayload.elementNumber === undefined) {
            return undefined;
        }

        const elements = await page.evaluate(() => window["elementInfo"]);
        if (elements === undefined || actionPayload.elementNumber < 0 || actionPayload.elementNumber >= elements.length) {
            return undefined;
        }
        return elements[actionPayload.elementNumber]; 
    }
    async getXY(page, actionPayload) {
        const element = await this.getElementInfo(page, actionPayload);

        if (element === undefined) {
            // fallback to x and y
            if (actionPayload.x === undefined || actionPayload.y === undefined) { 
                return undefined;
            } 
            return { x: actionPayload.x, y: actionPayload.y };
        }

        return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
    }

}

class ClickAction extends Action {
    constructor() {
        super('click');
    }

    async perform(page, actionPayload) {
        if (actionPayload.actionType !== this.actionType) {
            throw new Error('Action type does not match');
        }

        const xy = await this.getXY(page, actionPayload);
        const info = `Clicking at ${xy?.x}, ${xy?.y}`;
        if (xy !== undefined) {
             await page.mouse.click(xy.x, xy.y);
        }    
        return info; 
    }

    getPromptInfo() {
        return `To click on a element use the following action structure:
        1. "actionType": "click" (required)
        2. "elementNumber": The number of the element that is to be acted upon. The number is determined by the number in the yellow box around the element in the screenshot.  (required)`;
    }

    getDescriptionHTML(actionPayload) {
        if (actionPayload.actionType !== this.actionType) {
            throw new Error('Action type does not match');
        }
        return `
            <span id="action-icon">👆 ${actionPayload.actionType}</span>
             <p><b>Element Number:</b> <span id="elementNumber">${actionPayload.elementNumber}</span></p>`;
    }    
}

class ScrollAction extends Action {
    constructor() {
        super('scroll');
    }

    async perform(page, actionPayload) {
        if (actionPayload.actionType !== this.actionType) {
            throw new Error('Action type does not match');
        }

        let xy = await this.getXY(page, actionPayload);
        if (xy === undefined) {
            xy = { x: 0, y: 0 };
        }
        await page.mouse.move(xy.x, xy.y);

        let distanceX, distanceY;
        if ("distance" in actionPayload) {
            const viewport = await page.viewport();
            console.log("Viewport ", viewport);
            if (actionPayload["distance"] == "little") {
                distanceX = viewport.width / 4;
                distanceY = viewport.height / 4;
            } else if (actionPayload["distance"] == "medium") {
                distanceX = viewport.width / 2;
                distanceY = viewport.height / 2;
            } else if (actionPayload["distance"] == "far") {
                distanceX = viewport.width;    
                distanceY = viewport.height;
            } else {
                throw new Error("distance value little, medium or far should be given in scroll action");
            }
        } else {
            throw new Error("distance should be given in scroll action");
        }

        let deltaX = 0
        let deltaY = 0
        if ("direction" in actionPayload) {
            if (actionPayload["direction"] == "up") {
                deltaY = -parseInt(distanceY);
            } else if (actionPayload["direction"] == "down") {
                deltaY = parseInt(distanceY);
            } else if (actionPayload["direction"] == "left") {
                deltaX = -parseInt(distanceX);
            } else if (actionPayload["direction"] == "right") {
                deltaX = parseInt(distanceX);
            } else {
                throw new Error("Direction value up, down, left or right should be given in scroll action");
            }
        } else {
            throw new Error("direction should be given in scroll action");
        }

        const info = `Scrolling deltaX: ${deltaX}, deltaY: ${deltaY}`;
        await page.mouse.wheel({ deltaX: deltaX, deltaY: deltaY });
        return info;
    }

    getPromptInfo () {
        return `To scroll the page or inside an element use the following action structure:
        1. "actionType": "scroll" (required)
        2. "elementNumber": The number of the element or zero to scroll the page (required)
        3. "direction": either "up", "down", "left", "right" (required)
        4. "distance": either "little", "medium" or "far" (required)`;
    }

    getDescriptionHTML(actionPayload) {
        if (actionPayload.actionType !== this.actionType) {
            throw new Error('Action type does not match');
        }
        return `
            <span id="action-icon">🖱️ ${actionPayload.actionType}</span>
            <p><b>Element Number:</b> <span id="elementNumber">${actionPayload.elementNumber}</span></p>
            <p><b>Distance:</b> <span id="distance">${actionPayload.distance}</span></p>
            <p><b>Direction:</b> <span id="direction">${actionPayload.direction}</span></p>`;
    }
}

const actions = {
    click: new ClickAction(),
    scroll: new ScrollAction(),
};

module.exports = actions;


