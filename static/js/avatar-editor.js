// Avatar Editor
class AvatarEditor {
  constructor() {
    // Initialize state
    this.editorActive = false;
    this.selectedElement = null;
    this.isDragging = false;
    this.initialX = 0;
    this.initialY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.rightCheekCreated = false;
    
    // Initialize configuration with defaults
    this.config = {
      body: {
        width: '120px',
        height: '120px',
        color: '#5bbfdd'
      },
      face: {
        width: '50%',
        height: '40%',
        top: '30%',
        left: '50%',
        color: '#a8e4f3',
        scale: '2.0'
      },
      leftEye: {
        width: '16px',
        height: '16px',
        top: '20%',
        left: '36%'
      },
      rightEye: {
        width: '16px',
        height: '16px',
        top: '20%',
        right: '36%'
      },
      mouth: {
        width: '21px',
        height: '2px',
        top: '55%'
      },
      leftCheek: {
        width: '8px',
        height: '5px',
        top: '32%',
        left: '36%'
      },
      rightCheek: {
        width: '8px',
        height: '5px',
        top: '32%',
        right: '36%'
      },
      colorSets: [
        { body: '#5bbfdd', face: '#a8e4f3' }, // Default blue
        { body: '#ff9d7a', face: '#ffd4c2' }, // Warm orange
        { body: '#a5d6a7', face: '#c8e6c9' }, // Soft green
        { body: '#ce93d8', face: '#e1bee7' }, // Light purple
        { body: '#fff59d', face: '#fff9c4' }  // Pale yellow
      ],
      colorBehavior: {
        autonomousChanging: true,
        useRandomColors: false,
        minTransitionSpeed: 500,
        maxTransitionSpeed: 10000
      }
    };
    
    // Bind methods to ensure 'this' context is preserved
    this.handleGlobalWheel = this.handleGlobalWheel.bind(this);
    this.toggleEditor = this.toggleEditor.bind(this);
  }

  init() {
    // Find avatar element
    this.avatar = document.querySelector('.animated-avatar');
    if (!this.avatar) {
      console.error('Could not find avatar element');
      return;
    }
    
    // Create editor container
    const editorContainer = document.createElement('div');
    editorContainer.className = 'avatar-editor';
    editorContainer.style.display = 'none'; // Start hidden
    editorContainer.style.zIndex = '10000'; // Ensure above hero overlays
    editorContainer.innerHTML = `
      <style>
        /* Editor styles */
        .avatar-editor {
          position: fixed;
          /* sits above hero */
          top: 20px;
          right: 20px;
          width: 300px;
          background-color: #333;
          color: #fff;
          border-radius: 10px;
          padding: 15px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
          z-index: 1000;
          font-family: Arial, sans-serif;
          max-height: 80vh;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #5bbfdd #444;
        }
        
        /* Custom scrollbar for WebKit browsers */
        .avatar-editor::-webkit-scrollbar {
          width: 8px;
        }
        
        .avatar-editor::-webkit-scrollbar-track {
          background: #444;
          border-radius: 4px;
        }
        
        .avatar-editor::-webkit-scrollbar-thumb {
          background-color: #5bbfdd;
          border-radius: 4px;
        }
        
        .editor-controls {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        
        /* Fixed position buttons at the top */
        .editor-top-buttons {
          position: sticky;
          top: 0;
          background-color: #333;
          padding: 10px 0;
          margin-bottom: 10px;
          z-index: 10;
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
        }
        
        .dimension-controls {
          border: 1px solid #444;
          padding: 5px;
          border-radius: 3px;
          background-color: #333;
        }
        
        .dimension-row {
          display: flex;
          align-items: center;
          margin: 5px 0;
        }
        
        .dimension-row span {
          flex: 1;
          color: #ccc;
        }
        
        .dimension-row button {
          width: 25px;
          height: 25px;
          margin: 0 2px;
          cursor: pointer;
          background-color: #444;
          color: #fff;
          border: 1px solid #555;
          border-radius: 3px;
        }
        
        .dimension-row button:hover {
          background-color: #555;
        }
        
        .size-controls {
          display: flex;
          justify-content: center;
          gap: 5px;
        }
        
        .selected {
          outline: 2px solid #ff6600;
          outline-offset: 2px;
        }
        
        .draggable {
          cursor: move;
        }
        
        /* Always show eye and mouth dimension controls */
        .eye-dimension-controls, 
        .mouth-dimension-controls {
          display: block !important;
        }
        
        button {
          background-color: #444;
          color: #fff;
          border: 1px solid #555;
          border-radius: 3px;
          padding: 5px 10px;
          cursor: pointer;
        }
        
        button:hover {
          background-color: #555;
        }
        
        .editor-instructions {
          color: #aaa;
          font-size: 11px;
          margin-top: 10px;
          border-top: 1px solid #444;
          padding-top: 5px;
        }
        
        #css-output {
          background-color: #333;
          color: #ccc;
          border: 1px solid #444;
        }
        
        .mirror-controls {
          display: flex;
          justify-content: space-between;
          margin-top: 5px;
        }
        
        .mirror-controls button {
          font-size: 10px;
          padding: 3px 6px;
        }
        
        .position-controls {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1px;
          margin-top: 3px;
          width: 60px;
          margin-left: auto;
          margin-right: auto;
        }
        
        .position-controls button {
          font-size: 8px;
          padding: 1px;
          width: 18px;
          height: 18px;
          margin: 0;
        }
        
        .position-controls .up {
          grid-column: 2;
          grid-row: 1;
        }
        
        .position-controls .left {
          grid-column: 1;
          grid-row: 2;
        }
        
        .position-controls .right {
          grid-column: 3;
          grid-row: 2;
        }
        
        .position-controls .down {
          grid-column: 2;
          grid-row: 3;
        }
        
        .scale-controls {
          display: flex;
          justify-content: space-between;
          margin-top: 5px;
        }
        
        .scale-controls button {
          font-size: 10px;
          padding: 3px 6px;
        }
        
        .color-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        .control-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .control-group label {
          flex: 1;
        }
        
        .control-group input[type="color"] {
          width: 50px;
          height: 30px;
          padding: 0;
          border: none;
          border-radius: 3px;
        }
        
        .color-set-container {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
          background-color: #444;
          border-radius: 5px;
          margin-top: 15px;
        }
        
        .color-set {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px;
          background-color: #555;
          border-radius: 5px;
          position: relative;
        }
        
        .color-set-preview {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        
        .color-swatch {
          width: 25px;
          height: 25px;
          border-radius: 50%;
          border: 2px solid #777;
        }
        
        .color-set-body {
          border-radius: 50% 50% 40% 40%;
        }
        
        .color-set-face {
          border-radius: 3px;
        }
        
        .color-set-buttons {
          display: flex;
          gap: 5px;
          margin-left: auto;
        }
        
        .color-set-edit-panel {
          display: none;
          padding: 10px;
          background-color: #666;
          border-radius: 5px;
          margin-top: 5px;
        }
        
        .color-set-edit-panel.active {
          display: block;
        }
        
        .add-color-set {
          width: 100%;
          margin-top: 10px;
          background-color: #4a4a4a;
        }
        
        .add-color-set:hover {
          background-color: #5a5a5a;
        }
        
        .color-behavior-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 10px;
          background-color: #444;
          border-radius: 5px;
        }
        
        .switch-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 5px;
        }
        
        .switch {
          position: relative;
          display: inline-block;
          width: 50px;
          height: 24px;
        }
        
        .switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        
        .slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: #555;
          transition: .4s;
          border-radius: 24px;
        }
        
        .slider:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 4px;
          bottom: 4px;
          background-color: white;
          transition: .4s;
          border-radius: 50%;
        }
        
        input:checked + .slider {
          background-color: #5bbfdd;
        }
        
        input:checked + .slider:before {
          transform: translateX(26px);
        }
        
        .range-slider {
          width: 100%;
          margin: 10px 0;
        }
        
        .range-values {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #aaa;
        }
      </style>
      <div class="editor-controls">
        <div class="editor-top-buttons">
          <button id="toggle-editor">Close Editor</button>
          <button id="save-config">Save Configuration</button>
          <button id="reset-config">Reset to Default</button>
          <button id="preview-transition">Preview Color Transition</button>
        </div>
        <div class="dimension-controls">
          <label>Body Dimensions:</label>
          <div class="dimension-row">
            <span>Width:</span>
            <button id="width-down">-</button>
            <button id="width-up">+</button>
          </div>
          <div class="dimension-row">
            <span>Height:</span>
            <button id="height-down">-</button>
            <button id="height-up">+</button>
          </div>
          <div class="scale-controls">
            <button id="body-scale-down">Scale -</button>
            <button id="body-scale-up">Scale +</button>
          </div>
          <div class="color-controls">
            <div class="control-group">
              <label for="body-color">Body Color:</label>
              <input type="color" id="body-color" value="${this.config.body.color || '#5bbfdd'}">
            </div>
          </div>
        </div>
        <div class="dimension-controls">
          <label>Face Dimensions:</label>
          <div class="dimension-row">
            <span>Width:</span>
            <button id="face-width-down">-</button>
            <button id="face-width-up">+</button>
          </div>
          <div class="dimension-row">
            <span>Height:</span>
            <button id="face-height-down">-</button>
            <button id="face-height-up">+</button>
          </div>
          <div class="position-controls">
            <button class="up" id="face-up">↑</button>
            <button class="left" id="face-left">←</button>
            <button class="right" id="face-right">→</button>
            <button class="down" id="face-down">↓</button>
          </div>
          <div class="scale-controls">
            <button id="face-scale-down">Scale -</button>
            <button id="face-scale-up">Scale +</button>
            <button id="face-group-scale-down" title="Group Scale - (wheel over face)">Group -</button>
            <button id="face-group-scale-up" title="Group Scale + (wheel over face)">Group +</button>
          </div>
          <div class="dimension-row">
            <span>Overall Scale:</span>
            <input id="overall-scale" type="range" min="0.6" max="5" step="0.02" value="${this.config.face.scale || '2.0'}" style="flex:2;">
            <span id="overall-scale-val" style="width:50px; text-align:right;">${this.config.face.scale || '2.0'}×</span>
          </div>
          <div class="color-controls">
            <div class="control-group">
              <label for="face-color">Face Color:</label>
              <input type="color" id="face-color" value="${this.config.face.color || '#a8e4f3'}">
            </div>
          </div>
        </div>
        <div class="dimension-controls eye-dimension-controls">
          <label>Eye Dimensions:</label>
          <div class="dimension-row">
            <span>Width:</span>
            <button id="eye-width-down">-</button>
            <button id="eye-width-up">+</button>
          </div>
          <div class="dimension-row">
            <span>Height:</span>
            <button id="eye-height-down">-</button>
            <button id="eye-height-up">+</button>
          </div>
          <div class="position-controls">
            <button class="up" id="eye-up">↑</button>
            <button class="left" id="eye-left">←</button>
            <button class="right" id="eye-right">→</button>
            <button class="down" id="eye-down">↓</button>
          </div>
          <div class="scale-controls">
            <button id="eye-scale-down">Scale -</button>
            <button id="eye-scale-up">Scale +</button>
          </div>
          <div class="mirror-controls">
            <button id="mirror-eyes-horizontal">Mirror Horizontally</button>
          </div>
        </div>
        <div class="dimension-controls mouth-dimension-controls">
          <label>Mouth Dimensions:</label>
          <div class="dimension-row">
            <span>Width:</span>
            <button id="mouth-width-down">-</button>
            <button id="mouth-width-up">+</button>
          </div>
          <div class="dimension-row">
            <span>Height:</span>
            <button id="mouth-height-down">-</button>
            <button id="mouth-height-up">+</button>
          </div>
          <div class="position-controls">
            <button class="up" id="mouth-up">↑</button>
            <button class="left" id="mouth-left">←</button>
            <button class="right" id="mouth-right">→</button>
            <button class="down" id="mouth-down">↓</button>
          </div>
          <div class="scale-controls">
            <button id="mouth-scale-down">Scale -</button>
            <button id="mouth-scale-up">Scale +</button>
          </div>
        </div>
        <div class="dimension-controls cheek-dimension-controls">
          <label>Cheek Dimensions:</label>
          <div class="dimension-row">
            <span>Width:</span>
            <button id="cheek-width-down">-</button>
            <button id="cheek-width-up">+</button>
          </div>
          <div class="dimension-row">
            <span>Height:</span>
            <button id="cheek-height-down">-</button>
            <button id="cheek-height-up">+</button>
          </div>
          <div class="scale-controls">
            <button id="cheek-scale-down">Scale -</button>
            <button id="cheek-scale-up">Scale +</button>
          </div>
        </div>
        <div id="selected-element" style="font-size: 10px; margin-top: 5px; color: #aaa;">No element selected</div>
        <h4>Color Sets</h4>
        <div id="color-sets-container" class="color-set-container">
          ${this.generateColorSetsHTML()}
          <button id="add-color-set" class="add-color-set">Add New Color Set</button>
        </div>
        
        <h4>Color Behavior</h4>
        <div class="color-behavior-controls">
          <div class="switch-container">
            <span>Autonomous Color Changing:</span>
            <label class="switch">
              <input type="checkbox" id="autonomous-color-toggle" ${this.config.colorBehavior.autonomousChanging ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
          
          <div class="switch-container">
            <span>Use Random Colors:</span>
            <label class="switch">
              <input type="checkbox" id="random-color-toggle" ${this.config.colorBehavior.useRandomColors ? 'checked' : ''}>
              <span class="slider"></span>
            </label>
          </div>
          
          <div>
            <label for="transition-speed-range">Transition Speed Range:</label>
            <div class="range-values">
              <span>0.5s</span>
              <span>10s</span>
            </div>
            <input type="range" id="min-transition-speed" min="500" max="5000" value="${this.config.colorBehavior.minTransitionSpeed}" class="range-slider">
            <div class="range-values">
              <span>Min: <span id="min-speed-value">${this.config.colorBehavior.minTransitionSpeed / 1000}s</span></span>
            </div>
            <input type="range" id="max-transition-speed" min="5000" max="10000" value="${this.config.colorBehavior.maxTransitionSpeed}" class="range-slider">
            <div class="range-values">
              <span>Max: <span id="max-speed-value">${this.config.colorBehavior.maxTransitionSpeed / 1000}s</span></span>
            </div>
          </div>
        </div>
      </div>
      <div class="editor-instructions">
        <p>Drag elements to reposition | Click to select, then use +/- to resize</p>
        <p><small>Ctrl+click avatar to close editor</small></p>
      </div>
      <textarea id="css-output" style="width: 100%; height: 100px; margin-top: 10px; font-size: 12px;"></textarea>
    `;
    // Smooth color transitions to match main app
    try {
      const style = document.createElement('style');
      style.textContent = `
        .animated-avatar { transition: background-color 600ms ease; }
        .animated-avatar::before { transition: background-color 600ms ease, border-color 400ms ease; }
      `;
      document.head.appendChild(style);
    } catch(_) {}
    
    // Append editor container to document
    document.body.appendChild(editorContainer);
    this.editorContainer = editorContainer;
    
    // Add event listener to avatar for toggling editor
    this.avatar.addEventListener('click', (e) => this.handleAvatarClick(e));
    
    // Load saved configuration if available
    this.loadSavedConfiguration();
    
    // Store original positions and sizes
    this.storeOriginalPositionsAndSizes();
    
    // Add event listeners to editor controls
    this.addEventListeners();
    
    console.log('Avatar editor initialized');
  }

  handleAvatarClick(e) {
    // Only open editor on Ctrl+click
    if (e.ctrlKey) {
      console.log('Ctrl+Click detected on avatar');
      this.toggleEditor();
      e.preventDefault();
      e.stopPropagation();
    }
  }

  storeOriginalPositionsAndSizes() {
    // Get elements
    const leftEye = document.querySelector('.left-eye');
    const rightEye = document.querySelector('.right-eye');
    const mouth = document.querySelector('.mouth');
    const leftCheek = document.querySelector('.left-cheek');
    
    if (!leftEye || !rightEye || !mouth || !leftCheek) {
      console.error('Could not find all elements for storing original positions');
      return;
    }
    
    // Store original positions
    const leftEyeStyle = window.getComputedStyle(leftEye);
    const rightEyeStyle = window.getComputedStyle(rightEye);
    const mouthStyle = window.getComputedStyle(mouth);
    const leftCheekStyle = window.getComputedStyle(leftCheek);
    const avatarStyle = window.getComputedStyle(this.avatar);
    
    // Get face element (which is a pseudo-element in the CSS)
    // We'll use the avatar's ::before as the face
    const faceWidth = avatarStyle.getPropertyValue('--face-width') || '50%';
    const faceHeight = avatarStyle.getPropertyValue('--face-height') || '40%';
    
    // Get the face position from the pseudo-element
    const pseudoElementStyle = window.getComputedStyle(this.avatar, '::before');
    const faceTop = pseudoElementStyle.top || '30%';
    const faceLeft = pseudoElementStyle.left || '50%';
    
    this.originalPositions = {
      leftEye: {
        top: leftEyeStyle.top,
        left: leftEyeStyle.left
      },
      rightEye: {
        top: rightEyeStyle.top,
        right: rightEyeStyle.right
      },
      mouth: {
        top: mouthStyle.top
      },
      leftCheek: {
        top: leftCheekStyle.top,
        left: leftCheekStyle.left
      },
      face: {
        top: faceTop,
        left: faceLeft
      }
    };
    
    // Store right cheek position
    const rightCheek = document.querySelector('.right-cheek');
    if (rightCheek) {
      const rightCheekStyle = window.getComputedStyle(rightCheek);
      this.originalPositions.rightCheek = {
        top: rightCheekStyle.top,
        right: rightCheekStyle.right
      };
      
      // Update config with current values
      this.config.rightCheek.top = rightCheekStyle.top;
      this.config.rightCheek.right = rightCheekStyle.right;
      this.config.rightCheek.width = rightCheekStyle.width;
      this.config.rightCheek.height = rightCheekStyle.height;
    } else {
      // Default position if not found
      this.originalPositions.rightCheek = {
        top: '32%',
        right: '36%'
      };
    }
    
    // Store original sizes
    this.originalSizes = {
      eye: {
        width: leftEyeStyle.width,
        height: leftEyeStyle.height
      },
      mouth: {
        width: mouthStyle.width,
        height: mouthStyle.height
      },
      cheek: {
        width: leftCheekStyle.width,
        height: leftCheekStyle.height
      },
      face: {
        width: faceWidth,
        height: faceHeight
      },
      body: {
        width: avatarStyle.width,
        height: avatarStyle.height
      }
    };
    
    // Update config with current values
    this.config.leftEye.width = leftEyeStyle.width;
    this.config.leftEye.height = leftEyeStyle.height;
    this.config.leftEye.top = leftEyeStyle.top;
    this.config.leftEye.left = leftEyeStyle.left;
    
    this.config.rightEye.width = rightEyeStyle.width;
    this.config.rightEye.height = rightEyeStyle.height;
    this.config.rightEye.top = rightEyeStyle.top;
    this.config.rightEye.right = rightEyeStyle.right;
    
    this.config.mouth.width = mouthStyle.width;
    this.config.mouth.height = mouthStyle.height;
    this.config.mouth.top = mouthStyle.top;
    
    this.config.leftCheek.width = leftCheekStyle.width;
    this.config.leftCheek.height = leftCheekStyle.height;
    this.config.leftCheek.top = leftCheekStyle.top;
    this.config.leftCheek.left = leftCheekStyle.left;
    
    this.config.face.width = faceWidth;
    this.config.face.height = faceHeight;
    this.config.face.top = faceTop;
    this.config.face.left = faceLeft;
    
    this.config.body.width = avatarStyle.width;
    this.config.body.height = avatarStyle.height;
    
    console.log('Stored original positions and sizes');
  }

  toggleEditor() {
    this.editorActive = !this.editorActive;
    
    if (this.editorActive) {
      // Show editor
      const editorContainer = document.querySelector('.avatar-editor');
      editorContainer.style.display = 'block';
      
      // Store original positions and sizes before making elements draggable
      this.storeOriginalPositionsAndSizes();
      
      // Make elements draggable
      this.makeElementsDraggable();
      
      // Add editor-active class to avatar
      this.avatar.classList.add('editor-active');
      
      console.log('Editor activated');
    } else {
      // Hide editor
      const editorContainer = document.querySelector('.avatar-editor');
      editorContainer.style.display = 'none';
      
      // Remove draggable class from elements
      this.removeElementsDraggable();
      
      // Remove editor-active class from avatar
      this.avatar.classList.remove('editor-active');
      
      // Apply current configuration to ensure right cheek position is preserved
      this.applyConfigurationToCSS();
      
      console.log('Editor deactivated');
    }
  }

  makeElementsDraggable() {
    if (!this.editorActive) return;
    
    // Add draggable class to all editable elements
    const elements = {
      leftEye: document.querySelector('.left-eye'),
      rightEye: document.querySelector('.right-eye'),
      mouth: document.querySelector('.mouth'),
      leftCheek: document.querySelector('.left-cheek'),
      rightCheek: document.querySelector('.right-cheek') || this.createRightCheekElement(),
      visualFace: document.querySelector('.visual-face-element')
    };
    
    // Make avatar element have editor-active class
    this.avatar.classList.add('editor-active');
    
    // Show the visual face element in editor mode
    if (this.visualFace) {
      this.visualFace.style.display = 'block';
      this.visualFace.style.pointerEvents = 'auto';
      
      // Ensure the visual face element is below other elements
      this.visualFace.style.zIndex = '1';
      
      // Add click handler for the face element
      this.visualFace.addEventListener('mousedown', (e) => {
        // Only allow direct clicks on the face element, not when clicking through it
        if (e.target === this.visualFace) {
          this.handleElementMouseDown(e, this.visualFace);
        }
      });
      // Group scaling via wheel over the face overlay
      this.visualFace.addEventListener('wheel', (e) => {
        if (!this.editorActive) return;
        e.preventDefault();
        const step = e.shiftKey ? 0.02 : 0.08;
        const dir = e.deltaY > 0 ? -step : step;
        this.adjustFaceScale(dir);
      }, { passive: false });
    }
    
    // Add draggable class and mouse event listeners to each element
    for (const key in elements) {
      const element = elements[key];
      if (element) {
        element.classList.add('draggable');
        
        // Set higher z-index for eyes, mouth, and cheeks
        if (key === 'leftEye' || key === 'rightEye') {
          element.style.zIndex = '20';
        } else if (key === 'mouth' || key === 'leftCheek' || key === 'rightCheek') {
          element.style.zIndex = '15';
        }
        
        // Add mouse event listeners
        element.addEventListener('mousedown', (e) => {
          this.handleElementMouseDown(e, element);
        });
      }
    }
    
    // Add global mouse event listeners
    document.addEventListener('mousemove', this.handleMouseMove.bind(this));
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    document.addEventListener('wheel', this.handleGlobalWheel);
  }

  handleBodyClick(e) {
    if (!this.editorActive) return;
    
    // Only select the body if clicking directly on it (not on a child element)
    if (e.target !== this.avatar) return;
    
    console.log('Body clicked');
    
    // Set the selected element to the avatar body
    this.selectedElement = this.avatar;
    
    // Remove active class from all draggable elements
    document.querySelectorAll('.draggable').forEach(el => {
      el.classList.remove('active-drag');
    });
    
    // Update selected element display
    this.updateSelectedElementDisplay();
    
    e.preventDefault();
    e.stopPropagation();
  }

  updateSelectedElementDisplay() {
    const selectedDisplay = document.getElementById('selected-element');
    
    if (!this.selectedElement) {
      selectedDisplay.textContent = 'No element selected';
      return;
    }
    
    // Get computed style
    const style = window.getComputedStyle(this.selectedElement);
    
    // Format position information
    let position = '';
    let elementType = '';
    
    if (this.selectedElement.classList.contains('left-eye')) {
      elementType = 'Left Eye';
      position = `top: ${style.top}, left: ${style.left}`;
    } else if (this.selectedElement.classList.contains('right-eye')) {
      elementType = 'Right Eye';
      position = `top: ${style.top}, right: ${style.right}`;
    } else if (this.selectedElement.classList.contains('mouth')) {
      elementType = 'Mouth';
      position = `top: ${style.top}`;
    } else if (this.selectedElement.classList.contains('left-cheek')) {
      elementType = 'Left Cheek';
      position = `top: ${style.top}, left: ${style.left}`;
    } else if (this.selectedElement.classList.contains('right-cheek')) {
      elementType = 'Right Cheek';
      position = `top: ${style.top}, right: ${style.right}`;
    } else if (this.selectedElement.classList.contains('visual-face-element')) {
      elementType = 'Face';
      position = `top: ${style.top}, left: ${style.left}`;
    } else if (this.selectedElement === this.avatar) {
      elementType = 'Avatar Body';
      position = '';
    }
    
    // Format size information
    const size = `width: ${style.width}, height: ${style.height}`;
    
    // Update display
    selectedDisplay.textContent = `Selected: ${elementType} | ${position} | ${size}`;
  }

  resizeElement(element, delta) {
    console.log('Resizing element:', element, 'by delta:', delta);
    
    // Get current size
    const currentWidth = parseInt(getComputedStyle(element).width);
    const currentHeight = parseInt(getComputedStyle(element).height);
    
    // Calculate new size
    const newWidth = Math.max(5, currentWidth + delta);
    const newHeight = Math.max(5, currentHeight + delta);
    
    console.log(`Resizing from ${currentWidth}x${currentHeight} to ${newWidth}x${newHeight}`);
    
    // Update element size
    element.style.width = `${newWidth}px`;
    element.style.height = `${newHeight}px`;
    
    // Update configuration
    if (element === this.avatar) {
      this.config.body.width = `${newWidth}px`;
      this.config.body.height = `${newHeight}px`;
      console.log('Resized avatar to:', newWidth, newHeight);
    } else if (element.classList.contains('left-eye') || element.classList.contains('right-eye')) {
      this.config.leftEye.width = `${newWidth}px`;
      this.config.leftEye.height = `${newHeight}px`;
      
      // Update both eyes to keep them in sync
      const leftEye = document.querySelector('.left-eye');
      const rightEye = document.querySelector('.right-eye');
      
      if (leftEye && rightEye) {
        leftEye.style.width = `${newWidth}px`;
        leftEye.style.height = `${newHeight}px`;
        rightEye.style.width = `${newWidth}px`;
        rightEye.style.height = `${newHeight}px`;
      }
      
      console.log('Resized eyes to:', newWidth, newHeight);
    } else if (element.classList.contains('mouth')) {
      this.config.mouth.width = `${newWidth}px`;
      this.config.mouth.height = `${newHeight}px`;
      console.log('Resized mouth to:', newWidth, newHeight);
    } else if (element.classList.contains('left-cheek') || element.classList.contains('right-cheek')) {
      // Update both cheeks to keep them in sync
      const leftCheek = document.querySelector('.left-cheek');
      const rightCheek = document.querySelector('.right-cheek');
      
      if (leftCheek && rightCheek) {
        leftCheek.style.width = `${newWidth}px`;
        leftCheek.style.height = `${newHeight}px`;
        rightCheek.style.width = `${newWidth}px`;
        rightCheek.style.height = `${newHeight}px`;
      }
      
      this.config.leftCheek.width = `${newWidth}px`;
      this.config.leftCheek.height = `${newHeight}px`;
      this.config.rightCheek.width = `${newWidth}px`;
      this.config.rightCheek.height = `${newHeight}px`;
      console.log('Resized cheeks to:', newWidth, newHeight);
    } else if (element.classList.contains('face')) {
      this.config.face.width = `${newWidth}px`;
      this.config.face.height = `${newHeight}px`;
      console.log('Resized face to:', newWidth, newHeight);
    }
    
    // Update CSS output
    this.updateCssOutput();
    
    // Update selected element display
    this.updateSelectedElementDisplay();
  }

  updateCssOutput() {
    const css = `/* Avatar Body */
.animated-avatar {
  width: ${this.config.body.width};
  height: ${this.config.body.height};
  background-color: ${this.config.body.color};
}

/* Face */
.face {
  width: ${this.config.face.width};
  height: ${this.config.face.height};
  background-color: ${this.config.face.color};
}

/* Eyes */
.eye {
  position: absolute;
  width: ${this.config.leftEye.width};
  height: ${this.config.leftEye.height};
  background-color: #000;
  border-radius: 50%;
  top: ${this.config.leftEye.top};
  transition: all 0.2s ease;
  z-index: 20;
}

.left-eye {
  left: ${this.config.leftEye.left};
}

.right-eye {
  right: ${this.config.rightEye.right};
}

/* Mouth */
.mouth {
  position: absolute;
  width: ${this.config.mouth.width};
  height: ${this.config.mouth.height};
  background-color: #f47a7a;
  border-radius: 0 0 10px 10px;
  top: ${this.config.mouth.top};
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  border: 2px solid #c83333;
  border-top: none;
}

/* Cheeks */
.animated-avatar::after {
  content: '';
  position: absolute;
  width: ${this.config.rightCheek.width};
  height: ${this.config.rightCheek.height};
  background-color: #ffb6c1;
  border-radius: 50%;
  top: ${this.config.rightCheek.top};
  right: ${this.config.rightCheek.right};
  z-index: 15;
}

.animated-avatar .left-cheek {
  content: '';
  position: absolute;
  width: ${this.config.leftCheek.width};
  height: ${this.config.leftCheek.height};
  background-color: #ffb6c1;
  border-radius: 50%;
  top: ${this.config.leftCheek.top};
  left: ${this.config.leftCheek.left};
  z-index: 15;
}

.animated-avatar .right-cheek {
  content: '';
  position: absolute;
  width: ${this.config.rightCheek.width};
  height: ${this.config.rightCheek.height};
  background-color: #ffb6c1;
  border-radius: 50%;
  top: ${this.config.rightCheek.top};
  right: ${this.config.rightCheek.right};
  z-index: 15;
}`;
    
    this.cssOutput.value = css;
  }

  createRightCheekElement() {
    // Check if right cheek already exists
    const existingRightCheek = document.querySelector('.right-cheek');
    if (existingRightCheek) {
      console.log('Right cheek already exists, using existing element');
      return existingRightCheek;
    }
    
    // Create right cheek element
    const rightCheek = document.createElement('div');
    rightCheek.className = 'right-cheek';
    
    // Apply styles directly instead of trying to read from pseudo-element
    rightCheek.style.position = 'absolute';
    rightCheek.style.width = this.config.rightCheek.width;
    rightCheek.style.height = this.config.rightCheek.height;
    rightCheek.style.backgroundColor = '#ffb6c1';
    rightCheek.style.borderRadius = '50%';
    rightCheek.style.top = this.config.rightCheek.top;
    rightCheek.style.right = this.config.rightCheek.right;
    rightCheek.style.zIndex = '15';
    
    // Add to avatar
    this.avatar.appendChild(rightCheek);
    this.rightCheekCreated = true;
    console.log('Created right cheek element with position:', rightCheek.style.top, rightCheek.style.right);
    
    return rightCheek;
  }

  createVisualFaceElement() {
    // Create a div that represents the face for editing purposes
    const visualFace = document.createElement('div');
    visualFace.className = 'visual-face-element';
    visualFace.style.position = 'absolute';
    visualFace.style.backgroundColor = 'transparent'; // Make it transparent
    visualFace.style.border = '2px dashed #5bbfdd';
    visualFace.style.borderRadius = '10px';
    visualFace.style.zIndex = '1'; // Set to a very low z-index to stay behind other elements
    visualFace.style.pointerEvents = 'none'; // Don't capture pointer events by default
    visualFace.style.display = 'none'; // Hidden by default, shown in editor mode
    
    // Get face dimensions from CSS variables
    const computedStyle = window.getComputedStyle(this.avatar);
    const faceWidth = computedStyle.getPropertyValue('--face-width') || '50%';
    const faceHeight = computedStyle.getPropertyValue('--face-height') || '40%';
    
    // Convert percentages to pixels for initial setup
    const avatarWidth = parseInt(computedStyle.width);
    const avatarHeight = parseInt(computedStyle.height);
    const widthValue = parseInt(faceWidth);
    const heightValue = parseInt(faceHeight);
    
    // Set initial dimensions
    visualFace.style.width = faceWidth;
    visualFace.style.height = faceHeight;
    visualFace.style.top = '30%';
    visualFace.style.left = '50%';
    visualFace.style.transform = 'translate(-50%, -50%)';
    
    // Add to avatar
    this.avatar.appendChild(visualFace);
    this.visualFace = visualFace;
  }

  addEventListeners() {
    // Find all buttons
    const toggleBtn = document.getElementById('toggle-editor');
    const saveBtn = document.getElementById('save-config');
    const resetBtn = document.getElementById('reset-config');
    const sizeUpBtn = document.getElementById('size-up');
    const sizeDownBtn = document.getElementById('size-down');
    
    // Body dimension controls
    const widthUpBtn = document.getElementById('width-up');
    const widthDownBtn = document.getElementById('width-down');
    const heightUpBtn = document.getElementById('height-up');
    const heightDownBtn = document.getElementById('height-down');
    const bodyScaleUpBtn = document.getElementById('body-scale-up');
    const bodyScaleDownBtn = document.getElementById('body-scale-down');
    
    // Face dimension controls
    const faceWidthUpBtn = document.getElementById('face-width-up');
    const faceWidthDownBtn = document.getElementById('face-width-down');
    const faceHeightUpBtn = document.getElementById('face-height-up');
    const faceHeightDownBtn = document.getElementById('face-height-down');
    const faceUpBtn = document.getElementById('face-up');
    const faceDownBtn = document.getElementById('face-down');
    const faceLeftBtn = document.getElementById('face-left');
    const faceRightBtn = document.getElementById('face-right');
    const faceScaleUpBtn = document.getElementById('face-scale-up');
    const faceScaleDownBtn = document.getElementById('face-scale-down');
    
    // Eye dimension controls
    const eyeWidthUpBtn = document.getElementById('eye-width-up');
    const eyeWidthDownBtn = document.getElementById('eye-width-down');
    const eyeHeightUpBtn = document.getElementById('eye-height-up');
    const eyeHeightDownBtn = document.getElementById('eye-height-down');
    const eyeUpBtn = document.getElementById('eye-up');
    const eyeDownBtn = document.getElementById('eye-down');
    const eyeLeftBtn = document.getElementById('eye-left');
    const eyeRightBtn = document.getElementById('eye-right');
    const eyeScaleUpBtn = document.getElementById('eye-scale-up');
    const eyeScaleDownBtn = document.getElementById('eye-scale-down');
    const mirrorEyesHorizontalBtn = document.getElementById('mirror-eyes-horizontal');
    
    // Mouth dimension controls
    const mouthWidthUpBtn = document.getElementById('mouth-width-up');
    const mouthWidthDownBtn = document.getElementById('mouth-width-down');
    const mouthHeightUpBtn = document.getElementById('mouth-height-up');
    const mouthHeightDownBtn = document.getElementById('mouth-height-down');
    const mouthUpBtn = document.getElementById('mouth-up');
    const mouthDownBtn = document.getElementById('mouth-down');
    const mouthLeftBtn = document.getElementById('mouth-left');
    const mouthRightBtn = document.getElementById('mouth-right');
    const mouthScaleUpBtn = document.getElementById('mouth-scale-up');
    const mouthScaleDownBtn = document.getElementById('mouth-scale-down');
    
    // Color controls
    const bodyColorInput = document.getElementById('body-color');
    const faceColorInput = document.getElementById('face-color');
    
    // Add event listeners
    toggleBtn.addEventListener('click', this.toggleEditor);
    saveBtn.addEventListener('click', () => this.saveConfiguration());
    resetBtn.addEventListener('click', () => this.resetConfiguration());
    
    // Body dimension controls
    widthUpBtn.addEventListener('click', () => this.adjustBodyDimension('width', 5));
    widthDownBtn.addEventListener('click', () => this.adjustBodyDimension('width', -5));
    heightUpBtn.addEventListener('click', () => this.adjustBodyDimension('height', 5));
    heightDownBtn.addEventListener('click', () => this.adjustBodyDimension('height', -5));
    bodyScaleUpBtn.addEventListener('click', () => this.scaleElement('body', 1.05));
    bodyScaleDownBtn.addEventListener('click', () => this.scaleElement('body', 0.95));
    
    // Face dimension controls
    faceWidthUpBtn.addEventListener('click', () => this.adjustFaceDimension('width', 5));
    faceWidthDownBtn.addEventListener('click', () => this.adjustFaceDimension('width', -5));
    faceHeightUpBtn.addEventListener('click', () => this.adjustFaceDimension('height', 5));
    faceHeightDownBtn.addEventListener('click', () => this.adjustFaceDimension('height', -5));
    faceUpBtn.addEventListener('click', () => this.moveElement('face', 'top', -2));
    faceDownBtn.addEventListener('click', () => this.moveElement('face', 'top', 2));
    faceLeftBtn.addEventListener('click', () => this.moveElement('face', 'left', -2));
    faceRightBtn.addEventListener('click', () => this.moveElement('face', 'left', 2));
    faceScaleUpBtn.addEventListener('click', () => this.scaleElement('face', 1.05));
    faceScaleDownBtn.addEventListener('click', () => this.scaleElement('face', 0.95));
    
    // Eye dimension controls
    eyeWidthUpBtn.addEventListener('click', () => this.adjustEyeDimension('width', 1));
    eyeWidthDownBtn.addEventListener('click', () => this.adjustEyeDimension('width', -1));
    eyeHeightUpBtn.addEventListener('click', () => this.adjustEyeDimension('height', 1));
    eyeHeightDownBtn.addEventListener('click', () => this.adjustEyeDimension('height', -1));
    eyeUpBtn.addEventListener('click', () => this.moveElement('eyes', 'top', -1));
    eyeDownBtn.addEventListener('click', () => this.moveElement('eyes', 'top', 1));
    eyeLeftBtn.addEventListener('click', () => this.moveElement('eyes', 'left', -1));
    eyeRightBtn.addEventListener('click', () => this.moveElement('eyes', 'right', -1));
    eyeScaleUpBtn.addEventListener('click', () => this.scaleElement('eyes', 1.05));
    eyeScaleDownBtn.addEventListener('click', () => this.scaleElement('eyes', 0.95));
    mirrorEyesHorizontalBtn.addEventListener('click', () => this.mirrorElementsHorizontally('eyes'));
    
    // Mouth dimension controls
    mouthWidthUpBtn.addEventListener('click', () => this.adjustMouthDimension('width', 1));
    mouthWidthDownBtn.addEventListener('click', () => this.adjustMouthDimension('width', -1));
    mouthHeightUpBtn.addEventListener('click', () => this.adjustMouthDimension('height', 1));
    mouthHeightDownBtn.addEventListener('click', () => this.adjustMouthDimension('height', -1));
    mouthUpBtn.addEventListener('click', () => this.moveElement('mouth', 'top', -1));
    mouthDownBtn.addEventListener('click', () => this.moveElement('mouth', 'top', 1));
    mouthLeftBtn.addEventListener('click', () => this.moveElement('mouth', 'left', -1));
    mouthRightBtn.addEventListener('click', () => this.moveElement('mouth', 'right', -1));
    mouthScaleUpBtn.addEventListener('click', () => this.scaleElement('mouth', 1.05));
    mouthScaleDownBtn.addEventListener('click', () => this.scaleElement('mouth', 0.95));
    
    // Color controls
    bodyColorInput.addEventListener('input', (e) => this.updateColor('body', e.target.value));
    faceColorInput.addEventListener('input', (e) => this.updateColor('face', e.target.value));
    
    // Add event listeners for dragging and resizing
    document.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    document.addEventListener('wheel', (e) => this.handleWheel(e));
    
    // Add click listener to body to deselect elements
    document.body.addEventListener('click', (e) => this.handleBodyClick(e));
    
    // Preview transition button
    const previewTransitionBtn = document.getElementById('preview-transition');
    previewTransitionBtn.addEventListener('click', () => this.previewColorTransition());
    
    // Color set controls
    const addColorSetBtn = document.getElementById('add-color-set');
    if (addColorSetBtn) {
      addColorSetBtn.addEventListener('click', () => this.addNewColorSet());
    }
    
    // Initialize color set event listeners
    this.initColorSetEventListeners();
    
    // Color behavior controls
    const autonomousToggle = document.getElementById('autonomous-color-toggle');
    const randomColorToggle = document.getElementById('random-color-toggle');
    const minSpeedSlider = document.getElementById('min-transition-speed');
    const maxSpeedSlider = document.getElementById('max-transition-speed');
    const minSpeedValue = document.getElementById('min-speed-value');
    const maxSpeedValue = document.getElementById('max-speed-value');
    
    if (autonomousToggle) {
      autonomousToggle.addEventListener('change', (e) => {
        this.updateColorBehavior('autonomousChanging', e.target.checked);
      });
    }
    
    if (randomColorToggle) {
      randomColorToggle.addEventListener('change', (e) => {
        this.updateColorBehavior('useRandomColors', e.target.checked);
      });
    }
    
    if (minSpeedSlider) {
      minSpeedSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this.updateColorBehavior('minTransitionSpeed', value);
        if (minSpeedValue) {
          minSpeedValue.textContent = (value / 1000) + 's';
        }
      });
    }
    
    if (maxSpeedSlider) {
      maxSpeedSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        this.updateColorBehavior('maxTransitionSpeed', value);
        if (maxSpeedValue) {
          maxSpeedValue.textContent = (value / 1000) + 's';
        }
      });
    }
    
    // Cheek dimension controls
    const cheekWidthUpBtn = document.getElementById('cheek-width-up');
    const cheekWidthDownBtn = document.getElementById('cheek-width-down');
    const cheekHeightUpBtn = document.getElementById('cheek-height-up');
    const cheekHeightDownBtn = document.getElementById('cheek-height-down');
    const cheekScaleUpBtn = document.getElementById('cheek-scale-up');
    const cheekScaleDownBtn = document.getElementById('cheek-scale-down');
    if (cheekWidthUpBtn) cheekWidthUpBtn.addEventListener('click', () => this.adjustCheekDimension('width', 2));
    if (cheekWidthDownBtn) cheekWidthDownBtn.addEventListener('click', () => this.adjustCheekDimension('width', -2));
    if (cheekHeightUpBtn) cheekHeightUpBtn.addEventListener('click', () => this.adjustCheekDimension('height', 2));
    if (cheekHeightDownBtn) cheekHeightDownBtn.addEventListener('click', () => this.adjustCheekDimension('height', -2));
    if (cheekScaleUpBtn) cheekScaleUpBtn.addEventListener('click', () => this.scaleElement('cheek', 1.05));
    if (cheekScaleDownBtn) cheekScaleDownBtn.addEventListener('click', () => this.scaleElement('cheek', 0.95));
    
    console.log('Added event listeners');
  }

  // Add method to adjust body dimensions
  adjustBodyDimension(dimension, delta) {
    if (!this.editorActive) return;
    
    // Get current dimensions
    const currentWidth = parseInt(getComputedStyle(this.avatar).width) || 120;
    const currentHeight = parseInt(getComputedStyle(this.avatar).height) || 120;
    
    // Calculate new dimensions
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    
    if (dimension === 'width') {
      newWidth = Math.max(50, currentWidth + delta);
      this.avatar.style.width = `${newWidth}px`;
      this.config.body.width = `${newWidth}px`;
      console.log(`Adjusted body width to ${newWidth}px`);
    } else if (dimension === 'height') {
      newHeight = Math.max(50, currentHeight + delta);
      this.avatar.style.height = `${newHeight}px`;
      this.config.body.height = `${newHeight}px`;
      console.log(`Adjusted body height to ${newHeight}px`);
    }
    
    // Update CSS output
    this.updateCssOutput();
  }

  // Cheek dimension control (keeps both cheeks in sync)
  adjustCheekDimension(dimension, delta) {
    if (!this.editorActive) return;
    const leftCheek = document.querySelector('.left-cheek');
    const rightCheek = document.querySelector('.right-cheek') || this.createRightCheekElement();
    if (!leftCheek || !rightCheek) {
      console.error('Could not find cheek elements');
      return;
    }
    const curW = parseInt(getComputedStyle(leftCheek).width) || parseInt(this.config.leftCheek.width) || 8;
    const curH = parseInt(getComputedStyle(leftCheek).height) || parseInt(this.config.leftCheek.height) || 5;
    let newW = curW, newH = curH;
    if (dimension === 'width') newW = Math.max(5, Math.min(320, curW + delta));
    if (dimension === 'height') newH = Math.max(5, Math.min(320, curH + delta));
    leftCheek.style.width = `${newW}px`;
    leftCheek.style.height = `${newH}px`;
    rightCheek.style.width = `${newW}px`;
    rightCheek.style.height = `${newH}px`;
    this.config.leftCheek.width = `${newW}px`;
    this.config.leftCheek.height = `${newH}px`;
    this.config.rightCheek.width = `${newW}px`;
    this.config.rightCheek.height = `${newH}px`;
    this.updateCssOutput();
  }

  // Add method to adjust face dimensions
  adjustFaceDimension(dimension, delta) {
    if (!this.editorActive) return;
    
    // Get current dimensions from CSS variables
    const computedStyle = getComputedStyle(this.avatar);
    let currentWidth = computedStyle.getPropertyValue('--face-width') || '50%';
    let currentHeight = computedStyle.getPropertyValue('--face-height') || '40%';
    
    // Remove % and convert to number
    currentWidth = parseInt(currentWidth) || 50;
    currentHeight = parseInt(currentHeight) || 40;
    
    // Calculate new dimensions
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    
    if (dimension === 'width') {
      newWidth = Math.max(20, currentWidth + delta);
      this.avatar.style.setProperty('--face-width', `${newWidth}%`);
      this.config.face.width = `${newWidth}%`;
      console.log(`Adjusted face width to ${newWidth}%`);
    } else if (dimension === 'height') {
      newHeight = Math.max(20, currentHeight + delta);
      this.avatar.style.setProperty('--face-height', `${newHeight}%`);
      this.config.face.height = `${newHeight}%`;
      console.log(`Adjusted face height to ${newHeight}%`);
    }
    
    // Update visual face element if it exists
    if (this.visualFace) {
      if (dimension === 'width') {
        this.visualFace.style.width = `${newWidth}%`;
      } else if (dimension === 'height') {
        this.visualFace.style.height = `${newHeight}%`;
      }
    }
    
    // Update CSS output
    this.updateCssOutput();
  }

  // Fix the eye dimension method
  adjustEyeDimension(dimension, delta) {
    if (!this.editorActive) return;
    
    console.log(`Adjusting eye ${dimension} by ${delta}`);
    
    // Get the eye elements
    const leftEye = document.querySelector('.left-eye');
    const rightEye = document.querySelector('.right-eye');
    
    if (!leftEye || !rightEye) {
      console.error('Could not find eye elements');
      return;
    }
    
    // Get current dimensions - try multiple approaches to ensure we get values
    let currentWidth, currentHeight;
    
    // Try direct style first
    if (leftEye.style.width && leftEye.style.width !== '') {
      currentWidth = parseInt(leftEye.style.width);
    } else {
      // Try computed style
      currentWidth = parseInt(getComputedStyle(leftEye).width);
    }
    
    if (leftEye.style.height && leftEye.style.height !== '') {
      currentHeight = parseInt(leftEye.style.height);
    } else {
      // Try computed style
      currentHeight = parseInt(getComputedStyle(leftEye).height);
    }
    
    // Fallback to CSS variables if needed
    if (!currentWidth || isNaN(currentWidth)) {
      const cssVarWidth = getComputedStyle(this.avatar).getPropertyValue('--eye-width').trim();
      currentWidth = parseInt(cssVarWidth) || 16;
    }
    
    if (!currentHeight || isNaN(currentHeight)) {
      const cssVarHeight = getComputedStyle(this.avatar).getPropertyValue('--eye-height').trim();
      currentHeight = parseInt(cssVarHeight) || 16;
    }
    
    // Calculate new dimensions
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    
    if (dimension === 'width') {
      newWidth = Math.max(5, currentWidth + delta);
    } else if (dimension === 'height') {
      newHeight = Math.max(5, currentHeight + delta);
    }
    
    console.log(`New eye dimensions: width=${newWidth}px, height=${newHeight}px`);
    
    // Update both eyes
    leftEye.style.width = `${newWidth}px`;
    leftEye.style.height = `${newHeight}px`;
    rightEye.style.width = `${newWidth}px`;
    rightEye.style.height = `${newHeight}px`;
    
    // Update CSS variables
    this.avatar.style.setProperty('--eye-width', `${newWidth}px`);
    this.avatar.style.setProperty('--eye-height', `${newHeight}px`);
    
    // Update configuration
    if (!this.config.leftEye) this.config.leftEye = {};
    if (!this.config.rightEye) this.config.rightEye = {};
    
    this.config.leftEye.width = `${newWidth}px`;
    this.config.leftEye.height = `${newHeight}px`;
    this.config.rightEye.width = `${newWidth}px`;
    this.config.rightEye.height = `${newHeight}px`;
    
    console.log(`Adjusted eyes to ${newWidth}x${newHeight}`);
    
    // Update CSS output
    this.updateCssOutput();
  }

  // Fix the mouth dimension method
  adjustMouthDimension(dimension, delta) {
    if (!this.editorActive) return;
    
    console.log(`Adjusting mouth ${dimension} by ${delta}`);
    
    // Get the mouth element
    const mouth = document.querySelector('.mouth');
    
    if (!mouth) {
      console.error('Could not find mouth element');
      return;
    }
    
    // Get current dimensions from CSS variables
    const computedStyle = getComputedStyle(this.avatar);
    let currentWidth, currentHeight;
    
    // Try direct style first
    if (mouth.style.width && mouth.style.width !== '') {
      currentWidth = parseInt(mouth.style.width);
    } else {
      // Try computed style
      currentWidth = parseInt(getComputedStyle(mouth).width);
    }
    
    if (mouth.style.height && mouth.style.height !== '') {
      currentHeight = parseInt(mouth.style.height);
    } else {
      // Try computed style
      currentHeight = parseInt(getComputedStyle(mouth).height);
    }
    
    // Fallback to CSS variables if needed
    if (!currentWidth || isNaN(currentWidth)) {
      const cssVarWidth = getComputedStyle(this.avatar).getPropertyValue('--mouth-width').trim();
      currentWidth = parseInt(cssVarWidth) || 21;
    }
    
    if (!currentHeight || isNaN(currentHeight)) {
      const cssVarHeight = getComputedStyle(this.avatar).getPropertyValue('--mouth-height').trim();
      currentHeight = parseInt(cssVarHeight) || 2;
    }
    
    // Calculate new dimensions
    let newWidth = currentWidth;
    let newHeight = currentHeight;
    
    if (dimension === 'width') {
      newWidth = Math.max(5, currentWidth + delta);
    } else if (dimension === 'height') {
      newHeight = Math.max(2, currentHeight + delta);
    }
    
    console.log(`New mouth dimensions: width=${newWidth}px, height=${newHeight}px`);
    
    // Update CSS variables
    this.avatar.style.setProperty('--mouth-width', `${newWidth}px`);
    this.avatar.style.setProperty('--mouth-height', `${newHeight}px`);
    
    // Update mouth element directly
    mouth.style.width = `${newWidth}px`;
    mouth.style.height = `${newHeight}px`;
    
    // Update configuration
    if (!this.config.mouth) {
      this.config.mouth = {};
    }
    this.config.mouth.width = `${newWidth}px`;
    this.config.mouth.height = `${newHeight}px`;
    
    console.log(`Adjusted mouth ${dimension} to ${dimension === 'width' ? newWidth : newHeight}px`);
    
    // Update CSS output
    this.updateCssOutput();
  }

  removeElementsDraggable() {
    if (this.editorActive) return;
    
    // Reset z-index values when exiting editor mode
    const leftEye = document.querySelector('.left-eye');
    const rightEye = document.querySelector('.right-eye');
    const mouth = document.querySelector('.mouth');
    const leftCheek = document.querySelector('.left-cheek');
    const rightCheek = document.querySelector('.right-cheek');
    
    // Reset z-index to original values
    if (leftEye) leftEye.style.zIndex = '';
    if (rightEye) rightEye.style.zIndex = '';
    if (mouth) mouth.style.zIndex = '';
    if (leftCheek) leftCheek.style.zIndex = '';
    if (rightCheek) rightCheek.style.zIndex = '';
    
    const elements = [
      leftEye,
      rightEye,
      mouth,
      leftCheek,
      rightCheek,
      this.visualFace // Add the visual face element
    ];
    
    // Filter out null elements
    const validElements = elements.filter(el => el !== null);
    
    // Remove draggable functionality
    validElements.forEach(element => {
      // Hide the visual face element when not in editor mode
      if (element === this.visualFace) {
        element.style.display = 'none';
        element.style.pointerEvents = 'none';
      }
      
      element.classList.remove('draggable', 'selected');
      
      // Remove event listeners (simplified - in a real app you'd want to keep references to the bound functions)
      element.removeEventListener('mousedown', this.handleElementMouseDown);
      element.removeEventListener('click', () => {});
    });
    
    // Reset selected element
    this.selectedElement = null;
    this.updateSelectedElementDisplay();
    
    console.log('Removed draggable functionality');
  }

  handleElementMouseDown(e, element) {
    e.stopPropagation(); // Prevent event from bubbling up
    
    // Determine if this is a direct click on the element
    // For the face element, check if the click is on the border area
    if (element.classList.contains('visual-face-element')) {
      // Check if the click is on the border (::after pseudo-element)
      // Since we can't directly access pseudo-elements, we'll use position calculations
      const rect = element.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const borderWidth = 5; // Match the border width in CSS
      
      // Check if click is within the border area
      const isOnBorder = 
        x <= borderWidth || 
        y <= borderWidth || 
        x >= rect.width - borderWidth || 
        y >= rect.height - borderWidth;
      
      if (!isOnBorder) {
        // If not on border, let the click pass through to elements below
        return;
      }
    }
    
    // Set this element as selected
    this.selectedElement = element;
    
    // Update the display to show which element is selected
    this.updateSelectedElementDisplay();
    
    // Remove selected class from all elements
    document.querySelectorAll('.draggable').forEach(el => {
      el.classList.remove('selected');
    });
    
    // Add selected class to this element
    element.classList.add('selected');
    
    // Start dragging
    this.isDragging = true;
    this.initialX = e.clientX;
    this.initialY = e.clientY;
    
    // Store the current position for relative movement
    const style = window.getComputedStyle(element);
    this.currentX = parseInt(style.left) || 0;
    this.currentY = parseInt(style.top) || 0;
    
    // For elements positioned with 'right' instead of 'left'
    if (style.right !== 'auto' && !style.left) {
      this.isUsingRight = true;
      this.currentX = parseInt(style.right) || 0;
    } else {
      this.isUsingRight = false;
    }
  }

  handleMouseDown(e) {
    if (!this.editorActive) return;
    
    console.log('Mouse down event on:', e.target);
    
    // Check if the target or any of its parents has the draggable class
    let target = e.target;
    while (target && !target.classList.contains('draggable')) {
      target = target.parentElement;
      if (target === document.body) break;
    }
    
    if (target && target.classList.contains('draggable')) {
      // Remove active class from all draggable elements
      document.querySelectorAll('.draggable').forEach(el => {
        el.classList.remove('active-drag');
      });
      
      this.selectedElement = target;
      this.initialX = e.clientX;
      this.initialY = e.clientY;
      
      // Get current position
      const rect = this.selectedElement.getBoundingClientRect();
      this.currentX = rect.left;
      this.currentY = rect.top;
      
      // Add active class to show it's selected
      this.selectedElement.classList.add('active-drag');
      this.isDragging = true;
      
      // Update selected element display
      this.updateSelectedElementDisplay();
      
      console.log('Mouse down on element:', this.selectedElement);
      e.preventDefault();
      e.stopPropagation();
    }
  }

  handleMouseMove(e) {
    if (!this.isDragging || !this.selectedElement) return;
    
    e.preventDefault();
    
    // Calculate the new position
    this.currentX = e.clientX - this.initialX;
    this.currentY = e.clientY - this.initialY;
    
    // Move the element
    const element = this.selectedElement;
    const elementRect = element.getBoundingClientRect();
    const avatarRect = this.avatar.getBoundingClientRect();
    
    // Calculate position relative to avatar
    const relativeX = ((e.clientX - avatarRect.left) / avatarRect.width) * 100;
    const relativeY = ((e.clientY - avatarRect.top) / avatarRect.height) * 100;
    
    // Handle special case for the visual face element
    if (element === this.visualFace) {
      // Update the position of the visual face
      element.style.left = `${relativeX}%`;
      element.style.top = `${relativeY}%`;
      element.style.transform = 'translate(-50%, -50%)';
      
      // Update the actual face position by setting CSS variables
      // Store the position for the ::before pseudo-element
      this.config.face.top = `${relativeY}%`;
      this.config.face.left = `${relativeX}%`;
      
      // Update the actual pseudo-element position
      const style = document.createElement('style');
      style.textContent = `
        .animated-avatar::before {
          top: ${relativeY}% !important;
          left: ${relativeX}% !important;
        }
      `;
      
      // Remove any previous style element we added
      const previousStyle = document.getElementById('face-position-style');
      if (previousStyle) {
        previousStyle.remove();
      }
      
      // Add the new style element
      style.id = 'face-position-style';
      document.head.appendChild(style);
      
      // Update CSS output
      this.updateCssOutput();
      return;
    }
    
    // Handle eyes, mouth, and cheeks with perfect mirroring and leveling
    if (element.classList.contains('left-eye')) {
      const clampedX = Math.max(0, Math.min(100, relativeX));
      const clampedY = Math.max(0, Math.min(100, relativeY));
      // Left eye
      element.style.left = `${clampedX}%`;
      element.style.top = `${clampedY}%`;
      this.config.leftEye.left = `${clampedX}%`;
      this.config.leftEye.top = `${clampedY}%`;
      // Mirror to right eye
      const rightEye = document.querySelector('.right-eye');
      if (rightEye) {
        rightEye.style.right = `${clampedX}%`;
        rightEye.style.top = `${clampedY}%`;
        this.config.rightEye.right = `${clampedX}%`;
        this.config.rightEye.top = `${clampedY}%`;
      }
    } else if (element.classList.contains('right-eye')) {
      const clampedX = Math.max(0, Math.min(100, relativeX));
      const clampedY = Math.max(0, Math.min(100, relativeY));
      const rightPercent = Math.max(0, Math.min(100, 100 - clampedX));
      // Right eye
      element.style.right = `${rightPercent}%`;
      element.style.top = `${clampedY}%`;
      this.config.rightEye.right = `${rightPercent}%`;
      this.config.rightEye.top = `${clampedY}%`;
      // Mirror to left eye
      const leftEye = document.querySelector('.left-eye');
      if (leftEye) {
        leftEye.style.left = `${rightPercent}%`;
        leftEye.style.top = `${clampedY}%`;
        this.config.leftEye.left = `${rightPercent}%`;
        this.config.leftEye.top = `${clampedY}%`;
      }
    } else if (element.classList.contains('left-cheek')) {
      const clampedX = Math.max(0, Math.min(100, relativeX));
      const clampedY = Math.max(0, Math.min(100, relativeY));
      // Left cheek
      element.style.left = `${clampedX}%`;
      element.style.top = `${clampedY}%`;
      this.config.leftCheek.left = `${clampedX}%`;
      this.config.leftCheek.top = `${clampedY}%`;
      // Mirror to right cheek
      const rightCheek = document.querySelector('.right-cheek') || this.createRightCheekElement();
      if (rightCheek) {
        rightCheek.style.right = `${clampedX}%`;
        rightCheek.style.top = `${clampedY}%`;
        this.config.rightCheek.right = `${clampedX}%`;
        this.config.rightCheek.top = `${clampedY}%`;
      }
    } else if (element.classList.contains('right-cheek')) {
      const clampedX = Math.max(0, Math.min(100, relativeX));
      const clampedY = Math.max(0, Math.min(100, relativeY));
      const rightPercent = Math.max(0, Math.min(100, 100 - clampedX));
      // Right cheek
      element.style.right = `${rightPercent}%`;
      element.style.top = `${clampedY}%`;
      this.config.rightCheek.right = `${rightPercent}%`;
      this.config.rightCheek.top = `${clampedY}%`;
      // Mirror to left cheek
      const leftCheek = document.querySelector('.left-cheek');
      if (leftCheek) {
        leftCheek.style.left = `${rightPercent}%`;
        leftCheek.style.top = `${clampedY}%`;
        this.config.leftCheek.left = `${rightPercent}%`;
        this.config.leftCheek.top = `${clampedY}%`;
      }
    } else if (element.classList.contains('mouth')) {
      // Mouth is centered horizontally, so we only change the top
      element.style.top = `${relativeY}%`;
      
      // Update config
      this.config.mouth.top = `${relativeY}%`;
    }
    
    // Update CSS output
    this.updateCssOutput();
  }

  handleMouseUp(e) {
    if (this.selectedElement) {
      console.log('Mouse up, element released:', this.selectedElement);
    }
    this.isDragging = false;
    // Don't clear selectedElement so we can resize it with buttons
  }

  handleGlobalWheel(e) {
    if (!this.editorActive) return;
    
    console.log('Global wheel event detected');
    
    // Find the element under the cursor
    let target = document.elementFromPoint(e.clientX, e.clientY);
    
    // Check if the target or any of its parents has the draggable class
    while (target && !target.classList.contains('draggable') && target !== this.avatar) {
      target = target.parentElement;
      if (target === document.body) break;
    }
    
    if ((target && target.classList.contains('draggable')) || target === this.avatar) {
      e.preventDefault();
      
      // Group scale if over avatar root or face overlay
      if (target === this.avatar || (this.visualFace && target === this.visualFace)) {
        const step = e.shiftKey ? 0.02 : 0.08;
        const dir = e.deltaY > 0 ? -step : step;
        this.adjustFaceScale(dir);
      } else {
        // Calculate delta based on scroll direction and element type
        const isEye = target.classList && (target.classList.contains('left-eye') || target.classList.contains('right-eye'));
        const isCheek = target.classList && (target.classList.contains('left-cheek') || target.classList.contains('right-cheek'));
        const base = (isEye ? 6 : isCheek ? 6 : 2);
        const delta = (e.deltaY > 0 ? -base : base);
        // Resize the element
        this.resizeElement(target, delta);
      }
    }
  }

  adjustFaceScale(step) {
    // Read current
    const cs = getComputedStyle(this.avatar);
    let scaleStr = this.config.face.scale || cs.getPropertyValue('--face-scale') || '2.0';
    let current = parseFloat(String(scaleStr).trim()) || 2.0;
    let next = Math.max(0.6, Math.min(5.0, current + step));
    this.config.face.scale = `${next}`;
    this.avatar.style.setProperty('--face-scale', this.config.face.scale);
    this.updateCssOutput();
  }

  resizeSelected(delta) {
    if (!this.selectedElement) {
      alert('Please select an element to resize first');
      return;
    }
    
    this.resizeElement(this.selectedElement, delta);
  }

  saveConfiguration() {
    // Create a configuration object to save
    const config = {
      body: this.config.body,
      face: this.config.face,
      leftEye: this.config.leftEye,
      rightEye: this.config.rightEye,
      mouth: this.config.mouth,
      leftCheek: this.config.leftCheek,
      rightCheek: this.config.rightCheek,
      colorSets: this.config.colorSets,
      colorBehavior: this.config.colorBehavior
    };
    
    // Mark manual to disable auto-tighten on apply and save to localStorage
    config._manual = true;
    localStorage.setItem('avatarConfig', JSON.stringify(config));
    console.log('Saved configuration to localStorage:', config);
    
    // Also persist to backend so mobile/other devices load it
    try {
      const base = (window.proxyBase || `${window.location.protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`);
      fetch(`${base}/ui/face-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      }).catch(() => {});
    } catch (_) {}
    
    // Update the actual CSS file content
    this.applyConfigurationToCSS();
    
    // Show confirmation
    alert('Avatar configuration saved! The CSS has been updated and will persist between sessions.');
    
    // Exit editor mode
    this.toggleEditor();
  }

  applyConfigurationToCSS() {
    // Apply configuration to CSS
    const leftEye = document.querySelector('.left-eye');
    const rightEye = document.querySelector('.right-eye');
    const mouth = document.querySelector('.mouth');
    const leftCheek = document.querySelector('.left-cheek');
    const rightCheek = document.querySelector('.right-cheek');
    
    if (!leftEye || !rightEye || !mouth || !leftCheek || !rightCheek) {
      console.error('Could not find all elements for applying configuration');
      return;
    }
    
    // Apply eye configuration
    leftEye.style.top = this.config.leftEye.top;
    leftEye.style.left = this.config.leftEye.left;
    leftEye.style.width = this.config.leftEye.width;
    leftEye.style.height = this.config.leftEye.height;
    
    rightEye.style.top = this.config.rightEye.top;
    rightEye.style.right = this.config.rightEye.right;
    rightEye.style.width = this.config.leftEye.width; // Use left eye width for consistency
    rightEye.style.height = this.config.leftEye.height; // Use left eye height for consistency
    
    // Apply CSS variables
    this.avatar.style.setProperty('--eye-width', this.config.leftEye.width);
    this.avatar.style.setProperty('--eye-height', this.config.leftEye.height);
    this.avatar.style.setProperty('--left-eye-top', this.config.leftEye.top);
    this.avatar.style.setProperty('--left-eye-left', this.config.leftEye.left);
    this.avatar.style.setProperty('--right-eye-top', this.config.rightEye.top);
    this.avatar.style.setProperty('--right-eye-right', this.config.rightEye.right);
    
    // Apply mouth configuration
    mouth.style.top = this.config.mouth.top;
    mouth.style.width = this.config.mouth.width;
    mouth.style.height = this.config.mouth.height;
    
    // Apply CSS variables for mouth
    this.avatar.style.setProperty('--mouth-width', this.config.mouth.width);
    this.avatar.style.setProperty('--mouth-height', this.config.mouth.height);
    this.avatar.style.setProperty('--mouth-top', this.config.mouth.top);
    
    // Apply cheek configuration
    leftCheek.style.top = this.config.leftCheek.top;
    leftCheek.style.left = this.config.leftCheek.left;
    leftCheek.style.width = this.config.leftCheek.width;
    leftCheek.style.height = this.config.leftCheek.height;
    
    rightCheek.style.top = this.config.rightCheek.top;
    rightCheek.style.right = this.config.rightCheek.right;
    rightCheek.style.width = this.config.rightCheek.width;
    rightCheek.style.height = this.config.rightCheek.height;
    
    // Apply body configuration
    this.avatar.style.width = this.config.body.width;
    this.avatar.style.height = this.config.body.height;
    this.avatar.style.setProperty('--avatar-body-color', this.config.body.color);
    
    // Apply face configuration
    this.avatar.style.setProperty('--face-width', this.config.face.width);
    this.avatar.style.setProperty('--face-height', this.config.face.height);
    this.avatar.style.setProperty('--avatar-face-color', this.config.face.color);
    if (this.config.face.scale) {
      this.avatar.style.setProperty('--face-scale', this.config.face.scale);
    }
    
    console.log('Applied configuration to CSS');
  }

  loadSavedConfiguration() {
    // Default configuration
    this.config = {
      body: {
        width: '120px',
        height: '120px',
        color: '#5bbfdd'
      },
      face: {
        width: '50%',
        height: '40%',
        top: '30%',
        left: '50%',
        color: '#a8e4f3'
      },
      leftEye: {
        width: '16px',
        height: '16px',
        top: '20%',
        left: '36%'
      },
      rightEye: {
        width: '16px',
        height: '16px',
        top: '20%',
        right: '36%'
      },
      mouth: {
        width: '21px',
        height: '2px',
        top: '55%'
      },
      leftCheek: {
        width: '8px',
        height: '5px',
        top: '32%',
        left: '36%'
      },
      rightCheek: {
        width: '8px',
        height: '5px',
        top: '32%',
        right: '36%'
      },
      colorSets: [
        { body: '#5bbfdd', face: '#a8e4f3' }, // Default blue
        { body: '#ff9d7a', face: '#ffd4c2' }, // Warm orange
        { body: '#a5d6a7', face: '#c8e6c9' }, // Soft green
        { body: '#ce93d8', face: '#e1bee7' }, // Light purple
        { body: '#fff59d', face: '#fff9c4' }  // Pale yellow
      ],
      colorBehavior: {
        autonomousChanging: true,
        useRandomColors: false,
        minTransitionSpeed: 500,
        maxTransitionSpeed: 10000
      }
    };
    
    // Try to load server-saved configuration first for cross-device persistence
    const tryServer = async () => {
      try {
        const base = (window.proxyBase || `${window.location.protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}`);
        const res = await fetch(`${base}/ui/face-config`, { cache: 'no-store' });
        if (res && res.ok) {
          const serverCfg = await res.json();
          if (serverCfg && Object.keys(serverCfg).length) {
            this.config = this.mergeConfigs(this.config, serverCfg);
            console.log('Loaded server face-config', serverCfg);
            return true;
          }
        }
      } catch (_) {}
      return false;
    };
    const tryLocal = () => {
      const saved = localStorage.getItem('avatarConfig');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          this.config = this.mergeConfigs(this.config, parsed);
          console.log('Loaded local avatarConfig', this.config);
        } catch (e) {
          console.error('Failed to parse saved configuration', e);
        }
      }
    };
    
    // Load sequence: server then local fallback
    tryServer().then(found => { if (!found) tryLocal(); this.applyConfigurationToCSS(); });
    return;
  }

  mergeConfigs(defaultConfig, savedConfig) {
    // Create a deep copy of the default config
    const mergedConfig = JSON.parse(JSON.stringify(defaultConfig));
    
    // Merge saved config properties into the default config
    for (const key in savedConfig) {
      if (savedConfig.hasOwnProperty(key) && mergedConfig.hasOwnProperty(key)) {
        if (typeof savedConfig[key] === 'object' && savedConfig[key] !== null) {
          mergedConfig[key] = this.mergeConfigs(mergedConfig[key], savedConfig[key]);
        } else {
          mergedConfig[key] = savedConfig[key];
        }
      }
    }
    
    return mergedConfig;
  }

  resetConfiguration() {
    // Reset to original positions
    const leftEye = document.querySelector('.left-eye');
    const rightEye = document.querySelector('.right-eye');
    const mouth = document.querySelector('.mouth');
    const leftCheek = document.querySelector('.left-cheek');
    const rightCheek = document.querySelector('.right-cheek');
    
    if (!leftEye || !rightEye || !mouth || !leftCheek || !rightCheek) {
      console.error('Could not find all elements for reset');
      return;
    }
    
    leftEye.style.top = this.originalPositions.leftEye.top;
    leftEye.style.left = this.originalPositions.leftEye.left;
    
    rightEye.style.top = this.originalPositions.leftEye.top;
    rightEye.style.right = this.originalPositions.rightEye.right;
    
    mouth.style.top = this.originalPositions.mouth.top;
    
    leftCheek.style.top = this.originalPositions.leftCheek.top;
    leftCheek.style.left = this.originalPositions.leftCheek.left;
    
    rightCheek.style.top = this.originalPositions.rightCheek.top;
    rightCheek.style.right = this.originalPositions.rightCheek.right;
    
    // Reset sizes
    leftEye.style.width = this.originalSizes.eye.width;
    leftEye.style.height = this.originalSizes.eye.height;
    
    rightEye.style.width = this.originalSizes.eye.width;
    rightEye.style.height = this.originalSizes.eye.height;
    
    mouth.style.width = this.originalSizes.mouth.width;
    mouth.style.height = this.originalSizes.mouth.height;
    
    leftCheek.style.width = this.originalSizes.cheek.width;
    leftCheek.style.height = this.originalSizes.cheek.height;
    
    rightCheek.style.width = this.originalSizes.cheek.width;
    rightCheek.style.height = this.originalSizes.cheek.height;
    
    // Reset avatar body size
    this.avatar.style.width = this.originalSizes.body.width;
    this.avatar.style.height = this.originalSizes.body.height;
    this.avatar.style.setProperty('--avatar-body-color', this.originalSizes.body.color);
    
    // Reset config
    this.config.leftEye.top = this.originalPositions.leftEye.top;
    this.config.leftEye.left = this.originalPositions.leftEye.left;
    this.config.rightEye.top = this.originalPositions.leftEye.top;
    this.config.rightEye.right = this.originalPositions.rightEye.right;
    this.config.leftEye.width = this.originalSizes.eye.width;
    this.config.leftEye.height = this.originalSizes.eye.height;
    
    this.config.mouth.top = this.originalPositions.mouth.top;
    this.config.mouth.width = this.originalSizes.mouth.width;
    this.config.mouth.height = this.originalSizes.mouth.height;
    
    this.config.leftCheek.top = this.originalPositions.leftCheek.top;
    this.config.leftCheek.left = this.originalPositions.leftCheek.left;
    this.config.leftCheek.width = this.originalSizes.cheek.width;
    this.config.leftCheek.height = this.originalSizes.cheek.height;
    
    this.config.rightCheek.top = this.originalPositions.rightCheek.top;
    this.config.rightCheek.right = this.originalPositions.rightCheek.right;
    this.config.rightCheek.width = this.originalSizes.cheek.width;
    this.config.rightCheek.height = this.originalSizes.cheek.height;
    
    this.config.body.width = this.originalSizes.body.width;
    this.config.body.height = this.originalSizes.body.height;
    this.config.body.color = this.originalSizes.body.color;
    
    // Update CSS output
    this.updateCssOutput();
    
    console.log('Reset configuration to original');
  }

  // Add mirroring functionality
  mirrorElementsHorizontally(elementType) {
    if (!this.editorActive) return;
    
    if (elementType === 'eyes') {
      const leftEye = document.querySelector('.left-eye');
      const rightEye = document.querySelector('.right-eye');
      
      if (!leftEye || !rightEye) {
        console.error('Could not find eye elements');
        return;
      }
      
      // Get computed styles
      const leftEyeStyle = getComputedStyle(leftEye);
      const rightEyeStyle = getComputedStyle(rightEye);
      
      // Get positions
      const leftEyeTop = parseInt(leftEyeStyle.top);
      const rightEyeTop = parseInt(rightEyeStyle.top);
      const leftEyeLeft = parseInt(leftEyeStyle.left);
      const rightEyeRight = parseInt(rightEyeStyle.right);
      
      // Calculate average top position
      const avgTop = Math.round((leftEyeTop + rightEyeTop) / 2);
      
      // Set both eyes to the same top position
      leftEye.style.top = `${avgTop}px`;
      rightEye.style.top = `${avgTop}px`;
      
      // Update configuration
      this.config.leftEye.top = `${avgTop}px`;
      this.config.rightEye.top = `${avgTop}px`;
      
      // Make sure the left and right positions are mirrored
      const containerWidth = parseInt(getComputedStyle(this.avatar).width);
      const eyeWidth = parseInt(leftEyeStyle.width);
      
      // Calculate the distance from the edge
      const leftDistance = leftEyeLeft;
      const rightDistance = rightEyeRight;
      
      // Use the smaller distance for both eyes
      const minDistance = Math.min(leftDistance, rightDistance);
      
      // Update positions
      leftEye.style.left = `${minDistance}px`;
      rightEye.style.right = `${minDistance}px`;
      
      // Update configuration
      this.config.leftEye.left = `${minDistance}px`;
      this.config.rightEye.right = `${minDistance}px`;
      
      console.log(`Mirrored eyes horizontally at top: ${avgTop}px, distance: ${minDistance}px`);
      
      // Update CSS output
      this.updateCssOutput();
    }
  }

  // Add method to scale elements
  scaleElement(elementType, scaleFactor) {
    if (!this.editorActive) return;
    
    console.log(`Scaling ${elementType} by factor ${scaleFactor}`);
    
    if (elementType === 'body') {
      // Get current dimensions
      const currentWidth = parseInt(getComputedStyle(this.avatar).width) || 120;
      const currentHeight = parseInt(getComputedStyle(this.avatar).height) || 120;
      
      // Calculate new dimensions
      const newWidth = Math.max(50, Math.round(currentWidth * scaleFactor));
      const newHeight = Math.max(50, Math.round(currentHeight * scaleFactor));
      
      // Update avatar
      this.avatar.style.width = `${newWidth}px`;
      this.avatar.style.height = `${newHeight}px`;
      
      // Update configuration
      this.config.body.width = `${newWidth}px`;
      this.config.body.height = `${newHeight}px`;
      
      console.log(`Scaled body to ${newWidth}x${newHeight}`);
    } else if (elementType === 'face') {
      // Get current dimensions from CSS variables
      const computedStyle = getComputedStyle(this.avatar);
      let currentWidth = parseInt(computedStyle.getPropertyValue('--face-width')) || 50;
      let currentHeight = parseInt(computedStyle.getPropertyValue('--face-height')) || 40;
      
      // Calculate new dimensions
      const newWidth = Math.max(20, Math.round(currentWidth * scaleFactor));
      const newHeight = Math.max(20, Math.round(currentHeight * scaleFactor));
      
      // Update CSS variables
      this.avatar.style.setProperty('--face-width', `${newWidth}%`);
      this.avatar.style.setProperty('--face-height', `${newHeight}%`);
      
      // Update configuration
      this.config.face.width = `${newWidth}%`;
      this.config.face.height = `${newHeight}%`;
      
      // Update visual face element if it exists
      if (this.visualFace) {
        this.visualFace.style.width = `${newWidth}%`;
        this.visualFace.style.height = `${newHeight}%`;
      }
      
      console.log(`Scaled face to ${newWidth}%x${newHeight}%`);
    } else if (elementType === 'eyes') {
      // Get the current eye dimensions
      const leftEye = document.querySelector('.left-eye');
      const rightEye = document.querySelector('.right-eye');
      
      if (!leftEye || !rightEye) {
        console.error('Could not find eye elements');
        return;
      }
      
      // Get current dimensions
      const currentWidth = parseInt(getComputedStyle(leftEye).width);
      const currentHeight = parseInt(getComputedStyle(leftEye).height);
      
      // Calculate new dimensions
      const newWidth = Math.max(5, Math.round(currentWidth * scaleFactor));
      const newHeight = Math.max(5, Math.round(currentHeight * scaleFactor));
      
      // Update both eyes
      leftEye.style.width = `${newWidth}px`;
      leftEye.style.height = `${newHeight}px`;
      rightEye.style.width = `${newWidth}px`;
      rightEye.style.height = `${newHeight}px`;
      
      // Update CSS variables
      this.avatar.style.setProperty('--eye-width', `${newWidth}px`);
      this.avatar.style.setProperty('--eye-height', `${newHeight}px`);
      
      // Update configuration
      this.config.leftEye.width = `${newWidth}px`;
      this.config.leftEye.height = `${newHeight}px`;
      this.config.rightEye.width = `${newWidth}px`;
      this.config.rightEye.height = `${newHeight}px`;
      
      console.log(`Scaled eyes to ${newWidth}x${newHeight}`);
    } else if (elementType === 'mouth') {
      // Get the mouth element
      const mouth = document.querySelector('.mouth');
      
      if (!mouth) {
        console.error('Could not find mouth element');
        return;
      }
      
      // Get current dimensions - try multiple approaches to ensure we get values
      let currentWidth, currentHeight;
      
      // Try direct style first
      if (mouth.style.width && mouth.style.width !== '') {
        currentWidth = parseInt(mouth.style.width);
      } else {
        // Try computed style
        currentWidth = parseInt(getComputedStyle(mouth).width);
      }
      
      if (mouth.style.height && mouth.style.height !== '') {
        currentHeight = parseInt(mouth.style.height);
      } else {
        // Try computed style
        currentHeight = parseInt(getComputedStyle(mouth).height);
      }
      
      // Fallback to CSS variables if needed
      if (!currentWidth || isNaN(currentWidth)) {
        const cssVarWidth = getComputedStyle(this.avatar).getPropertyValue('--mouth-width').trim();
        currentWidth = parseInt(cssVarWidth) || 21;
      }
      
      if (!currentHeight || isNaN(currentHeight)) {
        const cssVarHeight = getComputedStyle(this.avatar).getPropertyValue('--mouth-height').trim();
        currentHeight = parseInt(cssVarHeight) || 2;
      }
      
      // Calculate new dimensions
      const newWidth = Math.max(5, Math.round(currentWidth * scaleFactor));
      const newHeight = Math.max(2, Math.round(currentHeight * scaleFactor));
      
      console.log(`Scaling mouth from ${currentWidth}x${currentHeight} to ${newWidth}x${newHeight}`);
      
      // Update CSS variables
      this.avatar.style.setProperty('--mouth-width', `${newWidth}px`);
      this.avatar.style.setProperty('--mouth-height', `${newHeight}px`);
      
      // Update mouth element directly
      mouth.style.width = `${newWidth}px`;
      mouth.style.height = `${newHeight}px`;
      
      // Update configuration
      if (!this.config.mouth) {
        this.config.mouth = {};
      }
      this.config.mouth.width = `${newWidth}px`;
      this.config.mouth.height = `${newHeight}px`;
      
      console.log(`Scaled mouth to ${newWidth}x${newHeight}`);
    }
    
    // Update CSS output
    this.updateCssOutput();
  }

  // Add method to move elements
  moveElement(elementType, direction, delta) {
    if (!this.editorActive) return;
    
    console.log(`Moving ${elementType} ${direction} by ${delta}`);
    
    if (elementType === 'face') {
      // Get current position
      const computedStyle = getComputedStyle(this.avatar);
      let currentTop = parseInt(this.config.face.top) || 30;
      let currentLeft = parseInt(this.config.face.left) || 50;
      
      // Calculate new position
      let newTop = currentTop;
      let newLeft = currentLeft;
      
      if (direction === 'top') {
        newTop = Math.max(10, Math.min(70, currentTop + delta));
      } else if (direction === 'left') {
        newLeft = Math.max(10, Math.min(90, currentLeft + delta));
      }
      
      // Update visual face element if it exists
      if (this.visualFace) {
        this.visualFace.style.top = `${newTop}%`;
        this.visualFace.style.left = `${newLeft}%`;
      }
      
      // Update configuration
      this.config.face.top = `${newTop}%`;
      this.config.face.left = `${newLeft}%`;
      
      console.log(`Moved face to top: ${newTop}%, left: ${newLeft}%`);
    } else if (elementType === 'eyes') {
      // Get the eye elements
      const leftEye = document.querySelector('.left-eye');
      const rightEye = document.querySelector('.right-eye');
      
      if (!leftEye || !rightEye) {
        console.error('Could not find eye elements');
        return;
      }
      
      // Get current positions
      const leftEyeStyle = getComputedStyle(leftEye);
      const rightEyeStyle = getComputedStyle(rightEye);
      
      let leftEyeTop = parseInt(leftEyeStyle.top) || 20;
      let leftEyeLeft = parseInt(leftEyeStyle.left) || 36;
      let rightEyeTop = parseInt(rightEyeStyle.top) || 20;
      let rightEyeRight = parseInt(rightEyeStyle.right) || 36;
      
      // Calculate new positions
      if (direction === 'top') {
        leftEyeTop = Math.max(5, Math.min(50, leftEyeTop + delta));
        rightEyeTop = Math.max(5, Math.min(50, rightEyeTop + delta));
        
        // Update eye positions
        leftEye.style.top = `${leftEyeTop}%`;
        rightEye.style.top = `${rightEyeTop}%`;
        
        // Update CSS variables
        this.avatar.style.setProperty('--left-eye-top', `${leftEyeTop}%`);
        this.avatar.style.setProperty('--right-eye-top', `${rightEyeTop}%`);
        
        // Update configuration
        this.config.leftEye.top = `${leftEyeTop}%`;
        this.config.rightEye.top = `${rightEyeTop}%`;
        
        console.log(`Moved eyes to top: ${leftEyeTop}%`);
      } else if (direction === 'left') {
        leftEyeLeft = Math.max(5, Math.min(45, leftEyeLeft + delta));
        
        // Update left eye position
        leftEye.style.left = `${leftEyeLeft}%`;
        
        // Update CSS variables
        this.avatar.style.setProperty('--left-eye-left', `${leftEyeLeft}%`);
        
        // Update configuration
        this.config.leftEye.left = `${leftEyeLeft}%`;
        
        console.log(`Moved left eye to left: ${leftEyeLeft}%`);
      } else if (direction === 'right') {
        rightEyeRight = Math.max(5, Math.min(45, rightEyeRight + delta));
        
        // Update right eye position
        rightEye.style.right = `${rightEyeRight}%`;
        
        // Update CSS variables
        this.avatar.style.setProperty('--right-eye-right', `${rightEyeRight}%`);
        
        // Update configuration
        this.config.rightEye.right = `${rightEyeRight}%`;
        
        console.log(`Moved right eye to right: ${rightEyeRight}%`);
      }
    } else if (elementType === 'mouth') {
      // Get the mouth element
      const mouth = document.querySelector('.mouth');
      
      if (!mouth) {
        console.error('Could not find mouth element');
        return;
      }
      
      // Get current position
      const computedStyle = getComputedStyle(mouth);
      let currentTop = parseInt(computedStyle.top) || 55;
      
      // Calculate new position
      let newTop = currentTop;
      
      if (direction === 'top') {
        newTop = Math.max(30, Math.min(70, currentTop + delta));
      }
      
      // Update mouth position
      mouth.style.top = `${newTop}%`;
      
      // Update CSS variables
      this.avatar.style.setProperty('--mouth-top', `${newTop}%`);
      
      // Update configuration
      if (!this.config.mouth) {
        this.config.mouth = {};
      }
      this.config.mouth.top = `${newTop}%`;
      
      console.log(`Moved mouth to top: ${newTop}%`);
    }
    
    // Update CSS output
    this.updateCssOutput();
  }

  // Add method to update color
  updateColor(element, color) {
    if (!this.editorActive) return;
    
    if (element === 'body') {
      this.config.body.color = color;
      this.avatar.style.setProperty('--avatar-body-color', color);
    } else if (element === 'face') {
      this.config.face.color = color;
      this.avatar.style.setProperty('--avatar-face-color', color);
    }
    
    // Update CSS output
    this.updateCssOutput();
  }

  // Update color behavior settings
  updateColorBehavior(property, value) {
    if (!this.editorActive) return;
    
    // Update config
    this.config.colorBehavior[property] = value;
    
    // Get avatar instance
    const avatarInstance = window.avatar;
    if (!avatarInstance) return;
    
    // Update avatar settings
    switch (property) {
      case 'autonomousChanging':
        avatarInstance.setAutonomousColorChanging(value);
        break;
      case 'useRandomColors':
        avatarInstance.setRandomColorMode(value);
        break;
      case 'minTransitionSpeed':
      case 'maxTransitionSpeed':
        avatarInstance.setTransitionSpeedRange(
          this.config.colorBehavior.minTransitionSpeed,
          this.config.colorBehavior.maxTransitionSpeed
        );
        break;
    }
    
    // Save configuration
    this.saveConfig();
  }

  // Apply the current configuration to the avatar
  applyConfig() {
    try {
      // Apply body configuration
      this.avatar.style.width = this.config.body.width;
      this.avatar.style.height = this.config.body.height;
      this.avatar.style.setProperty('--avatar-body-color', this.config.body.color);
      
      // Apply face configuration
      this.avatar.style.setProperty('--face-width', this.config.face.width);
      this.avatar.style.setProperty('--face-height', this.config.face.height);
      this.avatar.style.setProperty('--avatar-face-color', this.config.face.color);
      
      // Update avatar color sets
      this.updateAvatarColorSets();
      
      // Apply color behavior settings
      const avatarInstance = window.avatar;
      if (avatarInstance) {
        avatarInstance.setAutonomousColorChanging(this.config.colorBehavior.autonomousChanging);
        avatarInstance.setRandomColorMode(this.config.colorBehavior.useRandomColors);
        avatarInstance.setTransitionSpeedRange(
          this.config.colorBehavior.minTransitionSpeed,
          this.config.colorBehavior.maxTransitionSpeed
        );
      }
      
      console.log('Applied configuration to avatar');
    } catch (error) {
      console.error('Error applying configuration:', error);
    }
  }

  generateColorSetsHTML() {
    let html = '';
    
    this.config.colorSets.forEach((colorSet, index) => {
      html += `
        <div class="color-set" data-index="${index}">
          <div class="color-set-preview">
            <div class="color-swatch color-set-body" style="background-color: ${colorSet.body}"></div>
            <div class="color-swatch color-set-face" style="background-color: ${colorSet.face}"></div>
          </div>
          <span>Set ${index + 1}${index === 0 ? ' (Default)' : ''}</span>
          <div class="color-set-buttons">
            <button class="edit-color-set mini-button">Edit</button>
            <button class="apply-color-set mini-button">Apply</button>
            ${index > 0 ? `<button class="set-default-color-set mini-button">Set Default</button>` : ''}
            ${index > 0 ? `<button class="delete-color-set mini-button">Delete</button>` : ''}
          </div>
          <div class="color-set-edit-panel" id="color-set-edit-${index}">
            <div class="control-group">
              <label for="body-color">Body:</label>
              <input type="color" class="color-set-body-input" value="${colorSet.body}">
            </div>
            <div class="control-group">
              <label for="face-color">Face:</label>
              <input type="color" class="color-set-face-input" value="${colorSet.face}">
            </div>
            <button class="save-color-set mini-button">Save Changes</button>
          </div>
        </div>
      `;
    });
    
    return html;
  }

  initColorSetEventListeners() {
    // Edit color set buttons
    document.querySelectorAll('.edit-color-set').forEach(button => {
      button.addEventListener('click', (e) => {
        const colorSet = e.target.closest('.color-set');
        const index = colorSet.dataset.index;
        const editPanel = document.getElementById(`color-set-edit-${index}`);
        
        // Toggle edit panel
        editPanel.classList.toggle('active');
      });
    });
    
    // Apply color set buttons
    document.querySelectorAll('.apply-color-set').forEach(button => {
      button.addEventListener('click', (e) => {
        const colorSet = e.target.closest('.color-set');
        const index = colorSet.dataset.index;
        this.applyColorSet(parseInt(index));
      });
    });
    
    // Set default color set buttons
    document.querySelectorAll('.set-default-color-set').forEach(button => {
      button.addEventListener('click', (e) => {
        const colorSet = e.target.closest('.color-set');
        const index = colorSet.dataset.index;
        this.setDefaultColorSet(parseInt(index));
      });
    });
    
    // Delete color set buttons
    document.querySelectorAll('.delete-color-set').forEach(button => {
      button.addEventListener('click', (e) => {
        const colorSet = e.target.closest('.color-set');
        const index = colorSet.dataset.index;
        this.deleteColorSet(parseInt(index));
      });
    });
    
    // Save color set changes buttons
    document.querySelectorAll('.save-color-set').forEach(button => {
      button.addEventListener('click', (e) => {
        const colorSet = e.target.closest('.color-set');
        const index = colorSet.dataset.index;
        const bodyColor = colorSet.querySelector('.color-set-body-input').value;
        const faceColor = colorSet.querySelector('.color-set-face-input').value;
        
        this.updateColorSet(parseInt(index), bodyColor, faceColor);
      });
    });
  }

  addNewColorSet() {
    // Create a new color set based on current body and face colors
    const newColorSet = {
      body: this.config.body.color,
      face: this.config.face.color
    };
    
    // Add to config
    this.config.colorSets.push(newColorSet);
    
    // Refresh color sets display
    this.refreshColorSets();
    
    // Update avatar with new color sets
    this.updateAvatarColorSets();
    
    // Save configuration
    this.saveConfig();
  }

  deleteColorSet(index) {
    // Don't delete the default set
    if (index === 0) return;
    
    // Remove from config
    this.config.colorSets.splice(index, 1);
    
    // Refresh color sets display
    this.refreshColorSets();
    
    // Update avatar with new color sets
    this.updateAvatarColorSets();
    
    // Save configuration
    this.saveConfig();
  }

  updateColorSet(index, bodyColor, faceColor) {
    // Update config
    this.config.colorSets[index] = {
      body: bodyColor,
      face: faceColor
    };
    
    // Refresh color sets display
    this.refreshColorSets();
    
    // Update avatar with new color sets
    this.updateAvatarColorSets();
    
    // Save configuration
    this.saveConfig();
  }

  applyColorSet(index) {
    const colorSet = this.config.colorSets[index];
    
    // Update current colors
    this.config.body.color = colorSet.body;
    this.config.face.color = colorSet.face;
    
    // Update color inputs
    const bodyColorInput = document.getElementById('body-color');
    const faceColorInput = document.getElementById('face-color');
    
    if (bodyColorInput) bodyColorInput.value = colorSet.body;
    if (faceColorInput) faceColorInput.value = colorSet.face;
    
    // Apply to avatar
    this.avatar.style.setProperty('--avatar-body-color', colorSet.body);
    this.avatar.style.setProperty('--avatar-face-color', colorSet.face);
    
    // Set as default color set
    const avatarInstance = window.avatar;
    if (avatarInstance) {
      avatarInstance.setDefaultColorSetIndex(index);
    }
    
    // Update CSS output
    this.updateCssOutput();
    
    // Save configuration
    this.saveConfig();
  }

  refreshColorSets() {
    const container = document.getElementById('color-sets-container');
    if (!container) return;
    
    // Save the add button
    const addButton = container.querySelector('#add-color-set');
    
    // Clear container except for the add button
    container.innerHTML = this.generateColorSetsHTML();
    
    // Add the add button back
    container.appendChild(addButton);
    
    // Reinitialize event listeners
    this.initColorSetEventListeners();
  }

  updateAvatarColorSets() {
    // Get avatar instance
    const avatarInstance = window.avatar;
    if (!avatarInstance) return;
    
    // Update color sets
    avatarInstance.colorSets = [...this.config.colorSets];
  }

  previewColorTransition() {
    // Get avatar instance
    const avatarInstance = window.avatar;
    if (!avatarInstance) return;
    
    // Trigger a random color transition
    avatarInstance.transitionToRandomColorSet();
  }

  setDefaultColorSet(index) {
    // Don't do anything if it's already the default
    if (index === 0) return;
    
    // Get the color set to make default
    const newDefault = this.config.colorSets[index];
    
    // Remove it from its current position
    this.config.colorSets.splice(index, 1);
    
    // Insert it at the beginning (position 0)
    this.config.colorSets.unshift(newDefault);
    
    // Refresh color sets display
    this.refreshColorSets();
    
    // Update avatar with new color sets
    this.updateAvatarColorSets();
    
    // Update the default color set index in the avatar
    const avatarInstance = window.avatar;
    if (avatarInstance) {
      avatarInstance.setDefaultColorSetIndex(0);
    }
    
    // Save configuration
    this.saveConfig();
  }
}

// Initialize editor when DOM is loaded (delayed, EXACT as backup)
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing avatar editor');
  setTimeout(() => {
    const editor = new AvatarEditor();
    editor.init();
  }, 1000); // Give time for the avatar to initialize
});

// Ensure global access to the class for lazy init from WebUI
try { if (!window.AvatarEditor) window.AvatarEditor = AvatarEditor; } catch(_) {}

// Listen for cross-script requests to open the editor; create on demand
try {
  window.addEventListener('message', (ev) => {
    if (!ev) return;
    if (ev.data === 'OPEN_AVATAR_EDITOR') {
      try {
        if (!window.avatarEditor) {
          const ed = new AvatarEditor();
          ed.init();
          window.avatarEditor = ed;
        }
        if (window.avatarEditor && typeof window.avatarEditor.toggleEditor === 'function') {
          window.avatarEditor.toggleEditor();
        }
      } catch (e) { console.warn('Failed to open avatar editor via message', e); }
    }
  });
} catch(_) {}
