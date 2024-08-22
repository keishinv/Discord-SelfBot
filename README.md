# Setup
Open **.env**:
```  
USER_TOKEN = 
USER_PREFIX = 
```
Paste Discord account token to the end of **USER_TOKEN**

Set your preferred command prefix to **USER_PREFIX**

# How to get user token
1. Open Discord
2. Press `CTRL+SHIFT+I` to open the Developer Console
3. Copy and paste the code below into the console to automatically copy your user token to the clipboard.
```js
window.webpackChunkdiscord_app.push([
  [Math.random()],
  {},
  req => {
    if (!req.c) {
      console.error('req.c is undefined or null');
      return;
    }

    for (const m of Object.keys(req.c)
      .map(x => req.c[x].exports)
      .filter(x => x)) {
      if (m.default && m.default.getToken !== undefined) {
        return copy(m.default.getToken());
      }
      if (m.getToken !== undefined) {
        return copy(m.getToken());
      }
    }
  },
]);
console.log('%cWorked!', 'font-size: 50px');
console.log(`%cYou now have your token in the clipboard!`, 'font-size: 16px');
```
# Run Project
Make sure [Node.js](https://nodejs.org/en/download/prebuilt-installer/current) is installed 

Run ``` npm index.js ``` from root folder
# Discord SelfBot - Commands

> General Commands
- **`(delete_message del dm) delete_count channel_id`** - Deletes specified number of messages in a channel
