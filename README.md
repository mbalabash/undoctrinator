# Undoctrinator

Undoctrinator is a **proof-of-concept** Chrome Extension that runs machine learning models right in your browser. It analyzes text from webpages or images to uncover subtle bias and promoted values, giving you a deeper look into what you're actually reading.

### Features

- **On device processing**: analyzes text to identify ideological markers, promoted values, emotional manipulations, and logical fallacies.
- **Supports cloud models**: works with OpenAI and Claude, so you can use them for better performance.
- **Multipurpose**: can scan pages, images and selected text fragments.

> The performance of local models is far from perfect, so for everyday use it is recommended to employ one of the cloud models.

## How to Use

- Click the extension icon up in your toolbar to:
  - Analyze your current page
  - Analyze any image you want
- Found some text you're curious about? Select it, right-click, and hit "Undoctrinator: scan selected text"
- Explore report and insights
- What to switch the model? Right-click the extension icon, go to Options, and pick which model to use (you'll need your API keys for OpenAI or Claude)

![Undoctrinator in action](./demo.gif)

## Installation

### Via Chrome Web Store

1. Visit the [Undoctrinator extension page]() in the Chrome Web Store
2. Click "Add to Chrome"
3. Review and accept any permission requests
4. Pin the extension to your toolbar for quick access

### As a Developer (Unpacked Extension)

1. Clone or download this repository
2. Run in your CLI
   - `npm i`
   - `npm run build`
3. Navigate to `chrome://extensions/` in Chrome
4. Enable "Developer mode" using the toggle in the top-right corner
5. Click "Load unpacked" and select the Undoctrinator directory
6. The extension icon will appear in your browser toolbar (pin it for easier access)

## Release Notes

See the [CHANGELOG](./CHANGELOG.md) for a complete list of changes, updates, and fixes.

## License

This project is licensed under the [MIT License](./LICENSE).
