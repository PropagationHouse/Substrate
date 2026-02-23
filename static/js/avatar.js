// Simple animated avatar implementation
class AnimatedAvatar {
  constructor(containerId) {
    try {
      console.log('Initializing animated avatar');
      this.container = document.getElementById(containerId);
      
      if (!this.container) {
        console.error(`Avatar container with ID ${containerId} not found`);
        return;
      }
      
      this.state = 'idle';
      this.isAudioPlaying = false;
      this.isMoving = false;
      this.isAnimating = false; // New flag to track animation state
      // Scale factor for mouth size during speaking (WebUI tends smaller by default)
      this.mouthScale = 1.12; // ~20% smaller than 1.4 for main app; WebUI hero overrides below
      this.lastInteractionTime = Date.now();
      this.autonomousMovementEnabled = true;
      this.isRotating = false;
      this.isWavingArms = false;
      this.debugMode = true; // Enable debug mode
      
      // Initialize color sets
      this.colorSets = [
        { body: '#5bbfdd', face: '#a8e4f3' }, // Default blue
        { body: '#ff9d7a', face: '#ffd4c2' }, // Warm orange
        { body: '#a5d6a7', face: '#c8e6c9' }, // Soft green
        { body: '#ce93d8', face: '#e1bee7' }, // Light purple
        { body: '#fff59d', face: '#fff9c4' }  // Pale yellow
      ];
      this.defaultColorSetIndex = 0;
      this.currentColorSetIndex = 0;
      this.colorTransitionActive = false;
      this.colorTransitionInterval = null;
      
      // Animation tracking
      this._activeAnimations = new Set(); // Track active animations
      this._animationTimeouts = []; // Track animation timeouts for cleanup
      this._emotionScheduleTimeouts = []; // Track emotion schedule timeouts
      
      // Color behavior settings
      this.colorBehavior = {
        autonomousChanging: true,
        useRandomColors: false,
        minTransitionSpeed: 500,
        maxTransitionSpeed: 10000
      };
      
      // Render the avatar
      this.render();
      
      // Initialize CSS variables for dimensions
      this.initCssVariables();

      // If embedded in WebUI hero, lock to center and disable movement/drag
      this.isEmbeddedHero = (containerId === 'avatarContainer');
      if (this.isEmbeddedHero) {
        try {
          // Use larger mouth scale for WebUI hero context
          this.mouthScale = 2.55;
          // Disable autonomous movement and dragging for hero context
          this.autonomousMovementEnabled = false;
          // Stop any intervals if already set by previous instances
          if (this._autonomousMovementInterval) {
            clearInterval(this._autonomousMovementInterval);
            this._autonomousMovementInterval = null;
          }
          // Strongly prevent movement functions
          this.moveRandomly = () => {};
          this.startAutonomousMovement = () => {};
          this.makeDraggable = () => {};
          this.rotate3D = () => {};
          this.bounce = () => {};
          this.jiggle = () => {};
          this.moveTo = () => {};
          // Clear animations and transforms
          if (this.avatarEl) {
            this.avatarEl.style.animation = 'none';
            this.avatarEl.style.transform = 'none';
            this.avatarEl.style.position = 'relative';
            this.avatarEl.style.left = this.avatarEl.style.top = this.avatarEl.style.right = this.avatarEl.style.bottom = '';
            // Let CSS stylesheet control sizing (no inline override)
            this.avatarEl.style.width = '';
            this.avatarEl.style.height = '';
            this.avatarEl.style.margin = '0 auto';
          }
          // Prevent random behaviors from moving layout
          this.startRandomBehaviors = (() => {
            const orig = this.startRandomBehaviors.bind(this);
            return () => { try { orig(); } catch(_) {} };
          })();
          // Disable autonomous color cycling — WebUI syncs color from desktop via /api/ui/color
          this.transitionToRandomColorSet = () => {};
          this.transitionToColorSet = () => {};
          // Ensure clearAnimations never re-enables float
          const _origClear = this.clearAnimations.bind(this);
          this.clearAnimations = function(includeMouth = true){
            _origClear(includeMouth);
            if (this.avatarEl) {
              this.avatarEl.style.animation = 'none';
              this.avatarEl.style.transform = 'none';
            }
          };
        } catch(e) {
          console.warn('Embedded hero lock setup failed', e);
        }
      }
      
      // Ensure mouth is closed on startup
      if (this.mouth) {
        // Apply CSS variables instead of direct style
        const mouthWidth = getComputedStyle(this.avatarEl).getPropertyValue('--mouth-width').trim() || '21px';
        const mouthHeight = getComputedStyle(this.avatarEl).getPropertyValue('--mouth-height').trim() || '2px';
        
        // Set CSS variables
        this.avatarEl.style.setProperty('--mouth-width', mouthWidth);
        this.avatarEl.style.setProperty('--mouth-height', mouthHeight);
        
        // Ensure closed state is properly applied
        this.mouth.style.transition = 'height 0.1s ease-in-out';
      }
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Make the avatar draggable / autonomous movement only if not embedded in hero
      if (!this.isEmbeddedHero) {
        this.makeDraggable();
        this.startAutonomousMovement();
      }
      
      // Start random behaviors
      this.startRandomBehaviors();
      
      // Initialize cursor tracking
      this.initCursorTracking();
      
      console.log('Animated avatar initialized successfully');
    } catch (error) {
      console.error('Error initializing avatar:', error);
    }
  }
  
  // Read configured base sizes from CSS variables (set by face editor / face-config)
  getBaseSizes() {
    try {
      const s = this.avatarEl ? getComputedStyle(this.avatarEl) : null;
      const px = (v, fallback) => { const n = parseFloat(String(v).replace('px','')); return isNaN(n) ? fallback : n; };
      return {
        mouthW: px(s && s.getPropertyValue('--mouth-width'), 21),
        mouthH: px(s && s.getPropertyValue('--mouth-height'), 2),
        eyeW:   px(s && s.getPropertyValue('--eye-width'), 16),
        eyeH:   px(s && s.getPropertyValue('--eye-height'), 16),
      };
    } catch(_) { return { mouthW: 21, mouthH: 2, eyeW: 16, eyeH: 16 }; }
  }

  // Initialize CSS variables for dimensions (only set if not already configured)
  initCssVariables() {
    try {
      if (!this.avatarEl) return;
      const s = this.avatarEl.style;
      const cs = getComputedStyle(this.avatarEl);
      // Only set defaults if no value already exists
      if (!cs.getPropertyValue('--eye-width').trim()) s.setProperty('--eye-width', '16px');
      if (!cs.getPropertyValue('--eye-height').trim()) s.setProperty('--eye-height', '16px');
      if (!cs.getPropertyValue('--left-eye-top').trim()) s.setProperty('--left-eye-top', '20%');
      if (!cs.getPropertyValue('--left-eye-left').trim()) s.setProperty('--left-eye-left', '36%');
      if (!cs.getPropertyValue('--right-eye-top').trim()) s.setProperty('--right-eye-top', '20%');
      if (!cs.getPropertyValue('--right-eye-right').trim()) s.setProperty('--right-eye-right', '36%');
      if (!cs.getPropertyValue('--mouth-width').trim()) s.setProperty('--mouth-width', '21px');
      if (!cs.getPropertyValue('--mouth-height').trim()) s.setProperty('--mouth-height', '2px');
      if (!cs.getPropertyValue('--mouth-top').trim()) s.setProperty('--mouth-top', '60%');
      console.log('CSS variables initialized');
    } catch (error) {
      console.error('Error initializing CSS variables:', error);
    }
  }
  
  // Initialize cursor tracking
  initCursorTracking() {
    try {
      // Add mousemove event listener to track cursor
      document.addEventListener('mousemove', this.trackCursor.bind(this));
      console.log('Cursor tracking initialized');
      
      // Force an initial update to ensure everything is positioned correctly
      setTimeout(() => {
        // Simulate a mouse event at the center of the screen
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        const mockEvent = { clientX: centerX, clientY: centerY };
        this.trackCursor(mockEvent);
        
        if (this.debugMode) {
          console.log('Initial cursor tracking position set');
        }
      }, 500);
    } catch (error) {
      console.error('Error initializing cursor tracking:', error);
    }
  }
  
  render() {
    try {
      // Create the avatar element
      this.avatarEl = document.createElement('div');
      this.avatarEl.className = 'animated-avatar';
      this.avatarEl.id = 'animated-avatar';
      
      // Create eyes
      this.leftEye = document.createElement('div');
      this.leftEye.className = 'eye left-eye';
      
      this.rightEye = document.createElement('div');
      this.rightEye.className = 'eye right-eye';
      
      // Create mouth with inline style to force it closed
      this.mouth = document.createElement('div');
      this.mouth.className = 'mouth mouth-closed';
      
      // Create left cheek
      this.leftCheek = document.createElement('div');
      this.leftCheek.className = 'left-cheek';
      
      // Create right cheek
      this.rightCheek = document.createElement('div');
      this.rightCheek.className = 'right-cheek';
      
      // Create eyebrows (hidden by default, shown for expressions like angry)
      this.leftBrow = document.createElement('div');
      this.leftBrow.className = 'brow left-brow';
      
      this.rightBrow = document.createElement('div');
      this.rightBrow.className = 'brow right-brow';
      
      // Create arms
      this.leftArm = document.createElement('div');
      this.leftArm.className = 'arm left-arm';
      
      this.rightArm = document.createElement('div');
      this.rightArm.className = 'arm right-arm';
      
      // Explicitly set z-index for all elements to ensure proper layering
      this.leftEye.style.zIndex = '10';
      this.rightEye.style.zIndex = '10';
      this.leftBrow.style.zIndex = '11';
      this.rightBrow.style.zIndex = '11';
      this.mouth.style.zIndex = '5';
      this.leftCheek.style.zIndex = '4';
      this.rightCheek.style.zIndex = '4';
      
      // Append all elements to the avatar
      this.avatarEl.appendChild(this.leftBrow);
      this.avatarEl.appendChild(this.rightBrow);
      this.avatarEl.appendChild(this.leftEye);
      this.avatarEl.appendChild(this.rightEye);
      this.avatarEl.appendChild(this.mouth);
      this.avatarEl.appendChild(this.leftCheek);
      this.avatarEl.appendChild(this.rightCheek);
      this.avatarEl.appendChild(this.leftArm);
      this.avatarEl.appendChild(this.rightArm);
      
      // Append the avatar to the container
      this.container.appendChild(this.avatarEl);
      
      console.log('Avatar rendered successfully');
      return this.avatarEl;
    } catch (error) {
      console.error('Error rendering avatar:', error);
    }
  }
  
  setupEventListeners() {
    try {
      // Create a global method that can be called from anywhere
      window.handleVoiceStatusMessage = (status) => {
        try {
          console.log('Voice status message received directly:', status);
          this.handleVoiceStatus(status);
        } catch (error) {
          console.error('Error in handleVoiceStatusMessage:', error);
        }
      };
      
      // Expose the method on the avatar instance as well
      this.handleVoiceStatusMessage = (status) => {
        try {
          console.log('Voice status message received via instance method:', status);
          this.handleVoiceStatus(status);
        } catch (error) {
          console.error('Error in instance handleVoiceStatusMessage:', error);
        }
      };
      
      // Listen for messages from the proxy server
      const self = this;
      
      window.addEventListener('message', (event) => {
        try {
          const data = event.data;
          
          // Handle voice status messages
          if (data && data.type === 'voice-status') {
            console.log('Voice status message received via window message:', data.status);
            this.handleVoiceStatus(data.status);
          }
        } catch (error) {
          console.error('Error handling window message:', error);
        }
      });
      
      // Poll for active tool steps in the DOM (web search detection)
      // The tool call viewer creates .activity-step elements — these are proven to appear
      this._searchExpressionActive = false;
      this._searchGlowStartTime = 0;
      setInterval(() => {
        try {
          // Check for running search steps — only match actual search/browse tools
          const steps = document.querySelectorAll('.activity-step[data-status="running"]');
          let hasSearch = false;
          steps.forEach(step => {
            const text = (step.textContent || '').toLowerCase();
            if (text.includes('search') || text.includes('browse') || text.includes('perplexity') ||
                text.includes('googling') || text.includes('looking up') || text.includes('researching')) {
              hasSearch = true;
            }
          });
          
          // Safety: force-clear after 15s even if step is still "running"
          if (this._searchExpressionActive && Date.now() - this._searchGlowStartTime > 15000) {
            hasSearch = false;
            console.log('🔍 Search glow timeout (15s) — force clearing');
          }
          
          if (hasSearch && !this._searchExpressionActive) {
            this._searchExpressionActive = true;
            this._searchGlowStartTime = Date.now();
            this._stopEmotionCycle();
            this._fadeSearchGlow(true);
            console.log('🔍 Search tool detected — fading in searching expression');
          } else if (!hasSearch && this._searchExpressionActive) {
            this._searchExpressionActive = false;
            this._searchGlowStartTime = 0;
            this._fadeSearchGlow(false);
            console.log('🔍 Search tool finished — fading out searching expression');
          }
        } catch(e) {}
      }, 500);
      
      // Click handler: Ctrl+Click opens editor, normal click = poke reaction
      this._pokeCount = 0;
      this._pokeResetTimer = null;
      this.avatarEl.addEventListener('click', (evt) => {
        try {
          if (evt && evt.ctrlKey) {
            evt.preventDefault();
            evt.stopPropagation();
            if (typeof window.ensureAvatarEditorOpen === 'function') {
              window.ensureAvatarEditorOpen();
            } else if (window.avatarEditor && typeof window.avatarEditor.toggleEditor === 'function') {
              window.avatarEditor.toggleEditor();
            } else {
              try { window.postMessage('OPEN_AVATAR_EDITOR', '*'); } catch(_) {}
            }
          } else if (!window.isDraggingAvatar) {
            this._pokeReaction();
          }
        } catch (e) { console.warn('Click handler failed', e); }
      });
      
      // Double-click: poke reaction (no position reset, no 3D rotation)
      this.avatarEl.addEventListener('dblclick', (evt) => {
        try {
          evt.preventDefault();
          evt.stopPropagation();
          this.lastInteractionTime = Date.now();
          this._pokeReaction();
        } catch (error) {
          console.error('Error handling double-click:', error);
        }
      });
      
      // Add mousemove event to track cursor for eye movement
      document.addEventListener('mousemove', (e) => {
        try {
          this.trackCursor(e);
        } catch (error) {
          console.error('Error tracking cursor:', error);
        }
      });
      
      // Start random behaviors
      this.startRandomBehaviors();
      
      console.log('Event listeners set up successfully');
    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
  }
  
  handleVoiceStatus(status) {
    try {
      console.log('Handling voice status:', status);
      
      // Handle different voice statuses
      if (status === 'start' || status === 'speaking') {
        console.log('Voice started, animating mouth');
        this.isAudioPlaying = true;
        
        // Start mouth animation
        this.startMouthAnimation();
        
        // Start random emotion cycling while talking
        this._startEmotionCycle();
      } else if (status === 'end' || status === 'stopped') {
        console.log('Voice ended, stopping mouth animation');
        this.isAudioPlaying = false;
        
        // Stop mouth animation
        this.stopMouthAnimation();
        
        // Stop emotion cycling
        this._stopEmotionCycle();
      } else if (status === 'thinking') {
        console.log('Voice thinking, showing thinking animation');
        this.setState('thinking');
      }
    } catch (error) {
      console.error('Error handling voice status:', error);
    }
  }
  
  setState(state) {
    // Update state
    const prevState = this.state;
    this.state = state;
    
    // Clear existing animations
    this.clearAnimations();
    
    // Apply appropriate animation based on state
    switch (state) {
      case 'idle':
        this.startIdleAnimation();
        this.avatarEl.classList.add('idle');
        break;
      case 'talking':
        this.startTalkingAnimation();
        this.avatarEl.classList.remove('idle');
        break;
      case 'thinking':
        this.startThinkingAnimation();
        this.avatarEl.classList.remove('idle');
        break;
      default:
        // All emotion states handled by showEmotion
        if (AnimatedAvatar.EXPRESSION_CLASSES && AnimatedAvatar.EXPRESSION_CLASSES.includes(state)) {
          this.avatarEl.classList.remove('idle');
        }
        break;
    }
    
    console.log(`Avatar state changed to: ${state}`);
    // Broadcast state to backend for WebUI sync
    try { fetch((window.proxyBase || 'http://localhost:8765') + '/api/ui/color', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({expression: state, talking: state === 'talking'}) }).catch(()=>{}); } catch(_){}
  }
  
  clearAnimations(includeMouth = true) {
    try {
      // Clear all animation intervals
      if (this.talkInterval) {
        clearInterval(this.talkInterval);
        this.talkInterval = null;
      }
      
      if (this.armWavingInterval) {
        clearInterval(this.armWavingInterval);
        this.armWavingInterval = null;
      }
      
      if (this.colorTransitionInterval) {
        clearInterval(this.colorTransitionInterval);
        this.colorTransitionInterval = null;
        this.colorTransitionActive = false;
      }
      if (this._colorHeartbeat) {
        clearInterval(this._colorHeartbeat);
        this._colorHeartbeat = null;
      }
      
      // Clear all animation timeouts
      if (this._animationTimeouts && this._animationTimeouts.length > 0) {
        this._animationTimeouts.forEach(timeout => clearTimeout(timeout));
        this._animationTimeouts = [];
      }
      
      // Cancel any running emotion schedule
      this.cancelEmotionSchedule();
      
      // Clear active animations set
      if (this._activeAnimations) {
        this._activeAnimations.clear();
      }
      
      // Reset animation flags
      this.isRotating = false;
      this.isWavingArms = false;
      this.isAnimating = false;
      
      // Clear expression classes from all face elements
      if (this._clearExpressionClasses) {
        this._clearExpressionClasses();
      }
      
      // Reset mouth animation if requested
      if (includeMouth && this.mouth) {
        this.stopMouthAnimation();
      }
      
      // Reset any applied animations
      if (this.avatarEl) {
        this.avatarEl.style.animation = 'float 6s ease-in-out infinite';
        this.avatarEl.style.transform = '';
      }
      
      console.log('All animations cleared');
    } catch (error) {
      console.error('Error clearing animations:', error);
    }
  }
  
  startIdleAnimation() {
    try {
      // Ensure mouth is closed in idle state
      if (this.mouth) {
        // Apply CSS variables instead of direct style
        const mouthWidth = getComputedStyle(this.avatarEl).getPropertyValue('--mouth-width').trim() || '21px';
        const mouthHeight = getComputedStyle(this.avatarEl).getPropertyValue('--mouth-height').trim() || '2px';
        
        // Set CSS variables
        this.avatarEl.style.setProperty('--mouth-width', mouthWidth);
        this.avatarEl.style.setProperty('--mouth-height', mouthHeight);
        
        // Ensure closed state is properly applied
        this.mouth.style.transition = 'height 0.1s ease-in-out';
      }
      
      // We don't need to set up blinking here as it's already handled by scheduleNextBlink()
      // which is called in startRandomBehaviors()
      
      // Start random behaviors
      this.startRandomBehaviors();
      
      console.log('Idle animation started');
    } catch (error) {
      console.error('Error starting idle animation:', error);
    }
  }
  
  startTalkingAnimation() {
    // We don't need a separate blinking interval here as blinking is already 
    // handled by scheduleNextBlink() which is called in startRandomBehaviors()
    
    // No additional code needed here - the setState method already handles
    // setting the state to 'talking' and applying the appropriate animations
  }
  
  startThinkingAnimation() {
    // Thinking expression
    this.leftEye.classList.add('thinking');
    this.rightEye.classList.add('thinking');
    this.mouth.classList.add('thinking');
    this.avatarEl.classList.add('thinking');
  }
  
  startMouthAnimation() {
    try {
      if (this.mouthAnimationInterval) {
        clearInterval(this.mouthAnimationInterval);
      }
      
      // Don't call setState('talking') — that wipes expression classes.
      // Just mark state and start mouth animation directly.
      this.state = 'talking';
      
      // Remove mouth-closed class
      this.mouth.classList.remove('mouth-closed');
      
      // Remove the talking class if it exists (we'll use direct style manipulation)
      this.mouth.classList.remove('talking');
      
      // Set initial mouth style
      this.mouth.style.backgroundColor = '#ff6b6b';
      this.mouth.style.transition = 'all 0.15s ease-in-out';
      
      // Start arm waving animation when talking
      this.startArmWaving();
      
      // Define different mouth shapes for vowels and expressions
      const mouthShapes = [
        // A sound - wide oval with more height
        {
          height: '25px',
          width: '9px',
          borderRadius: '40%',
          transform: 'translateX(-50%)'
        },
        // E sound - wide smile with more height
        {
          height: '15px',
          width: '16px',
          borderRadius: '0 0 10px 10px',
          transform: 'translateX(-50%)'
        },
        // I sound - taller oval
        {
          height: '30px',
          width: '8px',
          borderRadius: '45%',
          transform: 'translateX(-50%)'
        },
        // O sound - perfect circle
        {
          height: '30px',
          width: '9px',
          borderRadius: '50%',
          transform: 'translateX(-50%)'
        },
        // WIDE OPEN O sound - very large circle
        {
          height: '35px',
          width: '11px',
          borderRadius: '50%',
          transform: 'translateX(-50%)'
        },
        // EXTREME O sound - extra large circle
        {
          height: '40px',
          width: '13px',
          borderRadius: '50%',
          transform: 'translateX(-50%)'
        },
        // SUPER EXTREME O sound - maximum circle
        {
          height: '45px',
          width: '16px',
          borderRadius: '50%',
          transform: 'translateX(-50%)'
        },
        // TRUE O SHAPE - very tall oval with narrow width
        {
          height: '45px',
          width: '9px',
          borderRadius: '50%',
          transform: 'translateX(-50%)'
        },
        // EXTREME TRUE O SHAPE - maximum height with minimum width
        {
          height: '50px',
          width: '8px',
          borderRadius: '50%',
          transform: 'translateX(-50%)'
        },
        // PERFECT CIRCLE O - perfectly round with equal dimensions
        {
          height: '15px',
          width: '15px',
          borderRadius: '50%',
          transform: 'translateX(-50%)',
          border: '3px solid #c83333'
        },
        // LARGE PERFECT CIRCLE O - larger perfectly round shape
        {
          height: '19px',
          width: '19px',
          borderRadius: '50%',
          transform: 'translateX(-50%)',
          border: '3px solid #c83333'
        },
        // Clear O shape - perfect circle with border
        {
          height: '35px',
          width: '11px',
          borderRadius: '50%',
          transform: 'translateX(-50%)',
          border: '3px solid #c83333'
        },
        // U sound - taller oval
        {
          height: '30px',
          width: '8px',
          borderRadius: '50%',
          transform: 'translateX(-50%)'
        },
        // Clear U shape - horseshoe shape
        {
          height: '28px',
          width: '9px',
          borderRadius: '0 0 10px 10px',
          transform: 'translateX(-50%)'
        },
        // Happy expression - wide smile with more height
        {
          height: '20px',
          width: '16px',
          borderRadius: '0 0 15px 15px',
          transform: 'translateX(-50%)'
        },
        // Original happy expression - wider smile with more height
        {
          height: '22px',
          width: '21px',
          borderRadius: '0 0 20px 20px',
          transform: 'translateX(-50%)'
        },
        // Surprised expression - very tall oval
        {
          height: '40px',
          width: '9px',
          borderRadius: '40% 40% 50% 50%',
          transform: 'translateX(-50%)'
        }
      ];
      
      // Helper to scale px values relative to configured base mouth size
      const base = this.getBaseSizes();
      const baseRef = 21; // original hardcoded reference width
      const sizeRatio = base.mouthW / baseRef;
      const scalePx = (px) => {
        try {
          const n = parseFloat(String(px).replace('px',''));
          if (isNaN(n)) return px;
          return `${Math.round(n * sizeRatio * (this.mouthScale || 1))}px`;
        } catch(_) { return px; }
      };

      // Ensure scaling happens from center of mouth during speaking
      if (this.mouth) this.mouth.style.transformOrigin = '50% 50%';

      // Use interval to cycle through different mouth shapes
      this.mouthAnimationInterval = setInterval(() => {
        try {
          // Occasionally use an extreme O shape (higher probability)
          let randomShape;
          if (Math.random() > 0.6) {
            // 40% chance of extreme O shapes
            const extremeShapes = [4, 5, 6, 7, 8, 9, 10]; // Indices of the extreme O shapes, including perfect circles
            const randomIndex = Math.floor(Math.random() * extremeShapes.length);
            randomShape = mouthShapes[extremeShapes[randomIndex]];
          } else {
            // 60% chance of other shapes
            randomShape = mouthShapes[Math.floor(Math.random() * mouthShapes.length)];
          }
          
          // Apply the shape (scaled for WebUI visibility)
          this.mouth.style.height = scalePx(randomShape.height);
          this.mouth.style.width = scalePx(randomShape.width);
          this.mouth.style.borderRadius = randomShape.borderRadius;
          this.mouth.style.transform = randomShape.transform;
          
          // Apply border if specified in the shape
          if (randomShape.border) {
            this.mouth.style.border = randomShape.border;
            this.mouth.style.borderTop = 'none';
          } else {
            this.mouth.style.border = '2px solid #c83333';
            this.mouth.style.borderTop = 'none';
          }
          
          // Scale mouth shapes while speaking
          this.mouth.style.transform = `translateX(-50%) scale(${this.mouthScale || 1})`;
          
          // Add more dramatic vertical movement (do not scale this)
          if (Math.random() > 0.5) {
            const verticalOffset = Math.random() > 0.5 ? 
              Math.floor(Math.random() * 4) + 1 + 'px' : // 1-4px up
              '-' + (Math.floor(Math.random() * 4) + 1) + 'px'; // 1-4px down
            this.mouth.style.transform = `translateX(-50%) scale(${this.mouthScale || 1}) translateY(${verticalOffset})`;
          }

        } catch (error) {
          console.error('Error in mouth animation:', error);
        }
      }, 120); // Even faster interval for more dynamic movement
      console.log('Mouth animation started with vowel shapes');
    } catch (error) {
      console.error('Error starting mouth animation:', error);
    }
  }
  
  stopMouthAnimation() {
    try {
      console.log('Stopping mouth animation');
      
      // Clear the animation interval
      if (this.mouthAnimationInterval) {
        clearInterval(this.mouthAnimationInterval);
        this.mouthAnimationInterval = null;
      }
      
      // Reset mouth to closed state
      if (this.mouth) {
        // Remove talking class
        this.mouth.classList.remove('talking');
        
        // Add closed mouth class
        this.mouth.classList.add('mouth-closed');
        
        // Clear inline width/height so .mouth-closed CSS class takes over
        // (.mouth-closed uses var(--mouth-width) and var(--mouth-height) set by face editor)
        this.mouth.style.width = '';
        this.mouth.style.height = '';
        this.mouth.style.borderRadius = '';
        this.mouth.style.transform = '';
        this.mouth.style.border = '';
        this.mouth.style.borderTop = '';
        this.mouth.style.backgroundColor = '';
        
        // Ensure the mouth is visible
        this.mouth.style.display = 'block';
      }
      
      // Stop arm waving when done talking
      this.stopArmWaving();
      
      // Reset state if needed
      if (this.state === 'talking') {
        this.setState('idle');
      }
      
      console.log('Mouth animation stopped');
    } catch (error) {
      console.error('Error stopping mouth animation:', error);
    }
  }
  
  testMouthAnimation() {
    console.log('Running test mouth animation');
    // Save current state
    const previousState = this.state;
    const wasPlaying = this.isAudioPlaying;
    
    // Temporarily set as talking
    this.isAudioPlaying = true;
    this.setState('talking');
    this.startMouthAnimation();
    
    // Animate for 2 seconds then restore previous state
    setTimeout(() => {
      this.isAudioPlaying = wasPlaying;
      this.stopMouthAnimation();
      this.setState(previousState);
      console.log('Test animation complete, restored state:', previousState);
      
      // Restore the idle class if returning to idle state
      if (previousState === 'idle') {
        this.avatarEl.classList.add('idle');
      }
    }, 2000);
  }
  
  startArmWaving() {
    // Clear any existing arm animation
    if (this.armWavingInterval) {
      clearInterval(this.armWavingInterval);
    }
    
    // Wave pattern values
    let wavePhase = 0;
    const waveSpeed = 0.1; // Controls speed of wave
    
    // Track extended state
    let armsExtended = false;
    let extensionTimer = null;
    
    this.armWavingInterval = setInterval(() => {
      if (!this.leftArm || !this.rightArm) return;
      
      // Calculate wave pattern
      wavePhase += waveSpeed;
      
      // Randomly decide to extend arms fully outward (wide open)
      if (!armsExtended && Math.random() < 0.015) { // 1.5% chance per frame
        // Extend arms outward
        this.leftArm.classList.add('extended');
        this.rightArm.classList.add('extended');
        
        // Rotate arms outward more - increased angle for more expressive gesture
        this.leftArm.style.transform = 'rotate(-80deg)';
        this.rightArm.style.transform = 'rotate(80deg)';
        
        // Set z-index to appear in front
        this.leftArm.style.zIndex = '10';
        this.rightArm.style.zIndex = '10';
        
        armsExtended = true;
        
        // Reset after a short time
        if (extensionTimer) clearTimeout(extensionTimer);
        extensionTimer = setTimeout(() => {
          this.leftArm.classList.remove('extended');
          this.rightArm.classList.remove('extended');
          armsExtended = false;
        }, 800 + Math.random() * 500); // Hold extended position for 0.8-1.3 seconds
      }
      
      // If arms aren't currently extended, do normal wave animation
      if (!armsExtended) {
        // Calculate arm rotations using sine waves for smooth back-and-forth motion
        // Limit rotation to prevent back edges from going past body
        const leftArmRotation = Math.max(-35, -20 - 15 * Math.sin(wavePhase));
        const rightArmRotation = Math.min(35, 20 + 15 * Math.sin(wavePhase + 1));
        
        // Apply rotations
        this.leftArm.style.transform = `rotate(${leftArmRotation}deg)`;
        this.rightArm.style.transform = `rotate(${rightArmRotation}deg)`;
        
        // Adjust horizontal position based on rotation to create more dynamic movement
        // Keep arms attached to body by limiting movement range
        const leftPos = Math.max(5, 5 - 2 * Math.sin(wavePhase));
        const rightPos = Math.max(5, 5 - 2 * Math.sin(wavePhase + 1));
        
        this.leftArm.style.left = `${leftPos}px`;
        this.rightArm.style.right = `${rightPos}px`;
        
        // Add vertical (up/down) movement
        // Base top position is 60% (from CSS)
        const baseTop = 60;
        const leftTop = baseTop - 3 * Math.cos(wavePhase * 0.8);
        const rightTop = baseTop - 3 * Math.cos((wavePhase + 1) * 0.8);
        
        this.leftArm.style.top = `${leftTop}%`;
        this.rightArm.style.top = `${rightTop}%`;
        
        // Reset z-index
        this.leftArm.style.zIndex = '5';
        this.rightArm.style.zIndex = '5';
      }
    }, 50); // Update frequently for smooth animation
  }
  
  stopArmWaving() {
    if (this.armWavingInterval) {
      clearInterval(this.armWavingInterval);
      this.armWavingInterval = null;
      
      // Reset arms to default position
      if (this.leftArm && this.rightArm) {
        // Remove extended class
        this.leftArm.classList.remove('extended');
        this.rightArm.classList.remove('extended');
        
        // Reset rotation
        this.leftArm.style.transform = 'rotate(-10deg)';
        this.rightArm.style.transform = 'rotate(10deg)';
        
        // Reset position
        this.leftArm.style.left = '5px';
        this.rightArm.style.right = '5px';
        this.leftArm.style.top = '60%';
        this.rightArm.style.top = '60%';
        
        // Reset z-index
        this.leftArm.style.zIndex = '5';
        this.rightArm.style.zIndex = '5';
      }
    }
  }
  
  // Enable autonomous movement
  startAutonomousMovement() {
    try {
      // Check if autonomous movement is already running
      if (this._autonomousMovementInterval) {
        clearInterval(this._autonomousMovementInterval);
        this._autonomousMovementInterval = null;
      }
      
      // Set up interval for autonomous movement
      this._autonomousMovementInterval = setInterval(() => {
        try {
          // Only move if autonomous movement is enabled and not currently moving, speaking, thinking, or animating
          if (this.autonomousMovementEnabled && 
              !this.isMoving && 
              !this.isAudioPlaying && 
              !this.isAnimating && 
              this.state !== 'thinking') {
            
            // Check if it's been a while since the last interaction
            const timeSinceLastInteraction = Date.now() - this.lastInteractionTime;
            
            // Move randomly after 30 seconds of inactivity
            if (timeSinceLastInteraction > 30000 && Math.random() < 0.1) {
              console.log('Starting autonomous movement');
              this.moveRandomly();
            }
            
            // Occasionally show an emotion with reduced probability
            if (timeSinceLastInteraction > 15000 && Math.random() < 0.05 && !this.isAnimating) {
              const emotions = ['happy', 'surprised', 'sad', 'angry', 'laughing', 'smiling', 'skeptical', 'sleepy', 'excited', 'confused'];
              const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)];
              console.log('Showing random emotion:', randomEmotion);
              
              // Set animating flag
              this.isAnimating = true;
              
              this.showEmotion(randomEmotion, 2000);
              
              // Reset animating flag after emotion completes
              setTimeout(() => {
                this.isAnimating = false;
              }, 2500);
            }
            
            // Occasionally do a little bounce or jiggle with reduced probability
            if (timeSinceLastInteraction > 10000 && Math.random() < 0.05 && !this.isAnimating) {
              // Set animating flag
              this.isAnimating = true;
              
              if (Math.random() < 0.5) {
                console.log('Doing autonomous bounce');
                this.bounce();
              } else {
                console.log('Doing autonomous jiggle');
                this.jiggle();
              }
              
              // Reset animating flag after animation completes
              setTimeout(() => {
                this.isAnimating = false;
              }, 2000);
            }
          }
        } catch (error) {
          console.error('Error in autonomous movement interval:', error);
          // Reset flags if there's an error
          this.isAnimating = false;
          this.isMoving = false;
        }
      }, 5000); // 5-second interval
      
      console.log('Autonomous movement started');
    } catch (error) {
      console.error('Error starting autonomous movement:', error);
    }
  }
  
  // Move the avatar randomly
  moveRandomly() {
    try {
      // Don't move if movement is disabled, audio is playing, or already moving
      if (!this.autonomousMovementEnabled || this.isAudioPlaying || this.isMoving) {
        return;
      }
      
      console.log('Moving randomly');
      
      // Set moving flag to prevent multiple movements
      this.isMoving = true;
      
      // Get current position
      const currentLeft = parseFloat(this.avatarEl.style.left) || 50;
      const currentTop = parseFloat(this.avatarEl.style.top) || 50;
      
      // Calculate new position (random movement within bounds)
      // Ensure we don't go too close to the edges (10% buffer)
      const maxLeft = 90; // Maximum left position (%)
      const minLeft = 10; // Minimum left position (%)
      const maxTop = 90;  // Maximum top position (%)
      const minTop = 10;  // Minimum top position (%)
      
      // Calculate random movement direction and distance
      const moveDistance = 10 + Math.random() * 30; // Move 10-40% of the way
      const moveAngle = Math.random() * Math.PI * 2; // Random angle in radians
      
      // Calculate new position using angle and distance
      let newLeft = currentLeft + Math.cos(moveAngle) * moveDistance;
      let newTop = currentTop + Math.sin(moveAngle) * moveDistance;
      
      // Ensure new position is within bounds
      newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
      newTop = Math.max(minTop, Math.min(maxTop, newTop));
      
      // Determine movement direction for animation selection
      const movingRight = newLeft > currentLeft;
      const movingDown = newTop > currentTop;
      
      // Calculate movement distance for animation duration
      const distance = Math.sqrt(
        Math.pow(newLeft - currentLeft, 2) + 
        Math.pow(newTop - currentTop, 2)
      );
      
      // Set animation duration based on distance (faster for shorter distances)
      // Base duration of 1 second, plus 0.5 seconds per 10% movement
      const duration = 1000 + (distance * 50);
      
      // Select appropriate animation based on movement direction
      if (Math.abs(newLeft - currentLeft) > Math.abs(newTop - currentTop)) {
        // Horizontal movement is dominant
        if (movingRight) {
          this.avatarEl.classList.add('moving-right');
        } else {
          this.avatarEl.classList.add('moving-left');
        }
      } else {
        // Vertical movement is dominant
        if (movingDown) {
          this.avatarEl.classList.add('moving-down');
        } else {
          this.avatarEl.classList.add('moving-up');
        }
      }
      
      // Apply smooth transition
      this.avatarEl.style.transition = `left ${duration}ms ease-in-out, top ${duration}ms ease-in-out`;
      
      // Move to new position
      this.avatarEl.style.left = `${newLeft}%`;
      this.avatarEl.style.top = `${newTop}%`;
      
      // Reset after animation completes
      const moveTimeout = setTimeout(() => {
        // Remove movement classes
        this.avatarEl.classList.remove(
          'moving-left', 
          'moving-right', 
          'moving-up', 
          'moving-down'
        );
        
        // Reset transition
        this.avatarEl.style.transition = '';
        
        // Reset moving flag
        this.isMoving = false;
        
        console.log('Random movement completed');
      }, duration + 100); // Add a small buffer
      
      // Store the timeout for cleanup
      this._animationTimeouts.push(moveTimeout);
      
      // Safety timeout to ensure flag is reset
      const safetyTimeout = setTimeout(() => {
        if (this.isMoving) {
          console.log('Movement safety timeout triggered');
          this.isMoving = false;
          
          // Remove movement classes
          this.avatarEl.classList.remove(
            'moving-left', 
            'moving-right', 
            'moving-up', 
            'moving-down'
          );
          
          // Reset transition
          this.avatarEl.style.transition = '';
        }
      }, duration + 1000); // 1 second safety buffer
      
      // Store the safety timeout for cleanup
      this._animationTimeouts.push(safetyTimeout);
      
    } catch (error) {
      console.error('Error in moveRandomly:', error);
      
      // Reset moving flag on error
      this.isMoving = false;
      
      // Remove any movement classes
      if (this.avatarEl) {
        this.avatarEl.classList.remove(
          'moving-left', 
          'moving-right', 
          'moving-up', 
          'moving-down'
        );
        
        // Reset transition
        this.avatarEl.style.transition = '';
      }
    }
  }
  
  // All expression class names used by the expression system
  static EXPRESSION_CLASSES = [
    'angry', 'sad', 'laughing', 'smiling', 'skeptical',
    'sleepy', 'excited', 'happy', 'surprised', 'confused', 'searching'
  ];

  // Clear all expression CSS classes from face elements
  _clearExpressionClasses() {
    const classes = AnimatedAvatar.EXPRESSION_CLASSES;
    for (const cls of classes) {
      this.leftEye.classList.remove(cls);
      this.rightEye.classList.remove(cls);
      this.mouth.classList.remove(cls);
      if (this.leftCheek) this.leftCheek.classList.remove(cls);
      if (this.rightCheek) this.rightCheek.classList.remove(cls);
      if (this.leftBrow) this.leftBrow.classList.remove(cls);
      if (this.rightBrow) this.rightBrow.classList.remove(cls);
      this.avatarEl.classList.remove(cls);
    }
  }

  // Show different emotions
  showEmotion(emotion, duration = 2000) {
    const prevState = this.state;
    
    // Clear previous expression classes
    this._clearExpressionClasses();
    
    // Remove idle class during emotions
    this.avatarEl.classList.remove('idle');
    
    console.log(`Showing emotion: ${emotion} for ${duration}ms`);
    // Broadcast emotion to backend for WebUI sync
    try { fetch((window.proxyBase || 'http://localhost:8765') + '/api/ui/color', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({expression: emotion}) }).catch(()=>{}); } catch(_){}
    
    // Expression definitions: each sets mouth shape + adds CSS classes for eyes/cheeks/body
    // Each expression has its OWN unique CSS class + distinct mouth shape
    const expressions = {
      happy: {
        // Closed happy eyes (upward arcs) + gentle smile curve
        mouth: { height: '8px', width: '22px', borderRadius: '0 0 50% 50%', bg: 'transparent', border: '2px solid #333', borderTop: 'none' },
        classes: ['happy'],
      },
      smiling: {
        // Eyes stay open (normal) + wide closed-lip smile — more subtle than happy
        mouth: { height: '6px', width: '26px', borderRadius: '0 0 50% 50%', bg: 'transparent', border: '2px solid #333', borderTop: 'none' },
        classes: ['smiling'],
      },
      surprised: {
        // Small round open "O" mouth, slightly enlarged eyes shifted up
        mouth: { height: '12px', width: '12px', borderRadius: '50%', bg: '#333', border: '2px solid #222', borderTop: '2px solid #222' },
        classes: ['surprised'],
      },
      confused: {
        // Wavy/tilted line, one big eye one small eye, body tilts
        mouth: { height: '2px', width: '18px', borderRadius: '0', bg: '#333', border: 'none', borderTop: 'none', transform: 'translateX(-50%) rotate(12deg)' },
        classes: ['confused'],
        bodyClass: 'confused',
      },
      angry: {
        // Tight flat line mouth (gritting), glowing rage eyes, body shakes
        mouth: { height: '2px', width: '20px', borderRadius: '0', bg: '#333', border: 'none', borderTop: 'none' },
        classes: ['angry'],
        bodyClass: 'angry',
      },
      sad: {
        // Frown (upward arc = sad curve), closed drooping eyes, body droops
        mouth: { height: '6px', width: '18px', borderRadius: '50% 50% 0 0', bg: 'transparent', border: '2px solid #333', borderBottom: 'none' },
        classes: ['sad'],
        bodyClass: 'sad',
      },
      laughing: {
        // Wide open grin showing inside, crescent arc eyes (shut from joy), bouncing + arms
        mouth: { height: '22px', width: '26px', borderRadius: '4px 4px 18px 18px', bg: '#ff6b6b', border: '2px solid #c83333', borderTop: 'none' },
        classes: ['laughing'],
        bodyClass: 'laughing',
        armWave: true,
      },
      skeptical: {
        // Flat straight mouth shifted to one side, one eye is a flat line, other is wide open
        mouth: { height: '3px', width: '14px', borderRadius: '1px', bg: '#000', border: 'none', borderTop: 'none', transform: 'translateX(-35%)' },
        classes: ['skeptical'],
      },
      sleepy: {
        // Eyes closed, mouth open in a yawn
        mouth: { height: '14px', width: '12px', borderRadius: '50%', bg: '#ff6b6b', border: '2px solid #c83333', borderTop: '2px solid #c83333' },
        classes: ['sleepy'],
        bodyClass: 'sleepy',
      },
      excited: {
        // Huge open grin, sparkly big eyes pulsing, fast bouncing + arms
        mouth: { height: '16px', width: '24px', borderRadius: '0 0 16px 16px', bg: '#ff6b6b', border: '2px solid #c83333', borderTop: 'none' },
        classes: ['excited'],
        bodyClass: 'excited',
        armWave: true,
      },
      searching: {
        // Glowing white emissive eyes, neutral mouth, connected to the net
        mouth: { height: '3px', width: '16px', borderRadius: '1px', bg: '#555', border: 'none', borderTop: 'none' },
        classes: ['searching'],
        bodyClass: 'searching',
      },
    };
    
    const expr = expressions[emotion];
    if (!expr) {
      console.warn(`Unknown emotion: ${emotion}`);
      return;
    }
    
    // Apply CSS classes to eyes, cheeks, body
    for (const cls of (expr.classes || [])) {
      this.leftEye.classList.add(cls);
      this.rightEye.classList.add(cls);
      if (this.leftCheek) this.leftCheek.classList.add(cls);
      if (this.rightCheek) this.rightCheek.classList.add(cls);
    }
    if (expr.browClass) {
      if (this.leftBrow) this.leftBrow.classList.add(expr.browClass);
      if (this.rightBrow) this.rightBrow.classList.add(expr.browClass);
    }
    if (expr.bodyClass) {
      this.avatarEl.classList.add(expr.bodyClass);
    }
    
    // Apply mouth shape — but NOT if currently talking (let mouth animation continue)
    if (!this.isAudioPlaying) {
      const m = expr.mouth;
      // Scale mouth dimensions relative to configured base size
      const base = this.getBaseSizes();
      const ratio = base.mouthW / 21; // 21px is the original reference width
      const scaleM = (v) => { const n = parseFloat(String(v).replace('px','')); return isNaN(n) ? v : Math.round(n * ratio) + 'px'; };
      this.mouth.classList.remove('mouth-closed');
      this.mouth.style.height = scaleM(m.height);
      this.mouth.style.width = scaleM(m.width);
      this.mouth.style.borderRadius = m.borderRadius;
      this.mouth.style.backgroundColor = m.bg || 'transparent';
      this.mouth.style.border = m.border || 'none';
      if (m.borderTop !== undefined) this.mouth.style.borderTop = m.borderTop;
      if (m.borderBottom !== undefined) this.mouth.style.borderBottom = m.borderBottom;
      if (m.borderLeft !== undefined) this.mouth.style.borderLeft = m.borderLeft;
      if (m.borderRight !== undefined) this.mouth.style.borderRight = m.borderRight;
      this.mouth.style.transform = m.transform || 'translateX(-50%)';
    }
    
    // Optional arm wave for energetic emotions
    if (expr.armWave) {
      this.startArmWaving();
    }
    
    // Reset after duration
    const resetTimeout = setTimeout(() => {
      this._clearExpressionClasses();
      
      // Only reset mouth if not currently talking
      if (!this.isAudioPlaying) {
        this.mouth.style.height = '';
        this.mouth.style.width = '';
        this.mouth.style.borderRadius = '';
        this.mouth.style.backgroundColor = '';
        this.mouth.style.border = '';
        this.mouth.style.borderTop = '';
        this.mouth.style.borderBottom = '';
        this.mouth.style.borderLeft = '';
        this.mouth.style.borderRight = '';
        this.mouth.style.transform = 'translateX(-50%)';
        this.mouth.classList.add('mouth-closed');
      }
      
      // Stop arm waving if it was started
      if (expr.armWave) {
        this.stopArmWaving();
      }
      
      // Restore previous state
      if (prevState === 'idle' && !this.isAudioPlaying) {
        this.avatarEl.classList.add('idle');
      }
      if (!this.isAudioPlaying) {
        this.state = prevState;
      }
    }, duration);
    this._animationTimeouts.push(resetTimeout);
  }
  
  // Play a scheduled sequence of emotions (from backend sentiment detection)
  // Each item: { emotion, delay (ms from start), duration (ms) }
  playEmotionSchedule(schedule) {
    if (!schedule || !schedule.length) return;
    
    // Cancel any existing emotion schedule
    this.cancelEmotionSchedule();
    
    this._emotionScheduleTimeouts = [];
    
    console.log(`Playing emotion schedule: ${schedule.map(s => s.emotion).join(' → ')}`);
    
    for (const item of schedule) {
      const t = setTimeout(() => {
        this.showEmotion(item.emotion, item.duration);
      }, item.delay);
      this._emotionScheduleTimeouts.push(t);
    }
  }
  
  // ── Frontend Emotion Detection ──────────────────────────────────────
  // Keyword-based sentiment analysis run directly on response text.
  // No backend/IPC dependency — works entirely in the renderer.
  
  static EMOTION_KEYWORDS = {
    happy: [
      'great', 'awesome', 'wonderful', 'fantastic', 'excellent', 'perfect',
      'glad', 'pleased', 'delighted', 'enjoy', 'love it', 'nice work',
      'well done', 'good job', 'congrats', 'congratulations', 'yay',
      'brilliant', 'superb', 'terrific', 'hooray', 'cheers',
      'beautiful', 'lovely', 'magnificent', 'splendid', 'bravo',
    ],
    smiling: [
      'happy to help', 'sure thing', 'no problem',
      'you bet', 'my pleasure', 'glad to help',
      'here you go', 'hope that helps', "you're welcome",
      'sounds good', 'right away', 'at your service',
    ],
    laughing: [
      'haha', 'hahaha', 'lol', 'lmao', 'rofl', 'hilarious', 'funny',
      'joke', 'crack up', 'dying', 'comedy', 'priceless',
      'absurd', 'cracked me up', 'too funny', 'laughing', 'giggle',
      'amusing', 'witty', 'humorous', 'comical',
    ],
    sad: [
      'sorry to hear', 'unfortunately', 'regret', 'heartbreaking',
      'devastating', 'tragic', 'grief', 'mourning', 'painful',
      'miss you', 'farewell', 'goodbye', 'passed away', 'condolences',
      'sympathies', 'tough time', 'difficult time',
      'disappointed', 'letdown', 'bummer', 'that sucks', 'too bad',
    ],
    angry: [
      'outrageous', 'unacceptable', 'furious', 'infuriating',
      'terrible', 'horrible', 'disgusting', 'appalling', 'inexcusable',
      'rage', 'livid', 'fed up', 'sick of', 'had enough',
      'damn it', 'pissed', 'annoying', 'irritating', 'maddening',
    ],
    surprised: [
      'wow', 'whoa', 'no way', 'unexpected', 'incredible', 'unbelievable',
      'shocking', 'mind blowing', 'mind-blowing', 'astonishing', 'stunned',
      'speechless', 'jaw dropped', 'can you believe', 'plot twist',
      'out of nowhere', 'holy cow', 'oh my',
      'remarkable', 'extraordinary',
    ],
    excited: [
      'exciting', 'thrilling', 'pumped', 'stoked', 'hyped', 'fired up',
      "can't wait", 'looking forward', 'amazing news', 'big news',
      'breakthrough', 'game changer', 'epic', 'legendary',
      "let's go", 'finally', 'at last', 'dream come true', 'milestone',
    ],
    confused: [
      'hmm', 'not sure', 'unclear', 'confusing', 'strange', 'weird',
      'odd', 'puzzling', 'baffling', 'perplexing', "doesn't make sense",
      'hard to understand', 'mixed signals', 'contradictory', 'ambiguous',
      'what do you mean', "i'm lost", 'wait what',
    ],
    skeptical: [
      'debatable', 'questionable', 'doubtful', 'suspicious',
      'not convinced', 'take it with a grain', 'allegedly',
      'supposedly', 'remains to be seen', 'jury is still out', 'iffy',
      'sketchy', 'fishy', 'hard to believe', 'think twice',
    ],
    searching: [
      'searching', 'looking up', 'let me find', 'browsing', 'web search',
      'googling', 'researching', 'investigating', 'digging into',
      'checking online', 'pulling up', 'fetching',
      'looking into', 'scanning',
    ],
    sleepy: [
      'goodnight', 'good night', 'sleep well', 'sweet dreams', 'tired',
      'exhausted', 'rest up', 'bedtime', 'drowsy', 'yawn',
      'winding down', 'calling it a night', 'lights out',
    ],
  };

  _detectEmotions(text) {
    if (!text || text.length < 20) return {};
    const lower = text.toLowerCase();
    const scores = {};
    for (const [emotion, keywords] of Object.entries(AnimatedAvatar.EMOTION_KEYWORDS)) {
      let hits = 0;
      for (const kw of keywords) {
        if (kw.includes(' ')) {
          // Multi-word phrase: simple includes
          if (lower.includes(kw)) hits++;
        } else {
          // Single word: word boundary check
          const regex = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          if (regex.test(lower)) hits++;
        }
      }
      if (hits > 0) scores[emotion] = hits;
    }
    // Sort by hits descending
    return Object.fromEntries(
      Object.entries(scores).sort((a, b) => b[1] - a[1])
    );
  }

  _buildEmotionSchedule(scores, maxEmotions = 4) {
    const entries = Object.entries(scores).slice(0, maxEmotions);
    if (!entries.length) return null;
    const dominant = entries[0][0];
    const dominantHits = entries[0][1];
    const schedule = [];
    let currentTime = 0;
    
    for (let i = 0; i < entries.length; i++) {
      const [emotion, hits] = entries[i];
      const ratio = hits / dominantHits;
      // 2000-5000ms, scaled by hit ratio + randomness
      let duration = 2000 + Math.floor(ratio * 3000) + Math.floor(Math.random() * 1000 - 500);
      duration = Math.max(2000, Math.min(5000, duration));
      
      schedule.push({ emotion, delay: currentTime, duration });
      currentTime += duration;
      
      // Cooldown 300-3000ms between emotions
      if (i < entries.length - 1) {
        currentTime += 300 + Math.floor(Math.random() * 2700);
      }
    }
    return { dominant, schedule };
  }

  _pokeReaction() {
    const now = Date.now();
    this.lastInteractionTime = now;
    this._pokeCount = (this._pokeCount || 0) + 1;
    
    // Track rapid pokes (within 1.5s of each other)
    if (this._lastPokeTime && now - this._lastPokeTime < 1500) {
      this._rapidPokeCount = (this._rapidPokeCount || 0) + 1;
    } else {
      this._rapidPokeCount = 0;
    }
    this._lastPokeTime = now;
    
    // Reset poke count after 8s of no poking
    if (this._pokeResetTimer) clearTimeout(this._pokeResetTimer);
    this._pokeResetTimer = setTimeout(() => { this._pokeCount = 0; this._rapidPokeCount = 0; }, 8000);
    
    const happyFaces = ['laughing', 'laughing', 'laughing', 'happy', 'smiling', 'excited'];
    const annoyedFaces = ['surprised', 'skeptical', 'confused'];
    
    // Random anger on any poke (~8% chance) — the occasional snap
    if (Math.random() < 0.08) {
      this.showEmotion('angry', 1800);
      return;
    }
    
    if (this._rapidPokeCount >= 10) {
      // Aggressively spamming for a while — full rage + spin
      // But 30% chance to just laugh it off anyway
      if (Math.random() < 0.3) {
        this.showEmotion('laughing', 2000);
      } else {
        this.showEmotion('angry', 3000);
        this.rotate3D();
      }
    } else if (this._rapidPokeCount >= 7 || this._pokeCount >= 12) {
      // Getting mad — but sometimes reverts to laughing
      if (Math.random() < 0.35) {
        this.showEmotion('laughing', 1800);
      } else {
        this.showEmotion('angry', 2000);
      }
    } else if (this._rapidPokeCount >= 4 || this._pokeCount >= 7) {
      // Getting annoyed — but still might laugh
      if (Math.random() < 0.4) {
        this.showEmotion('laughing', 1500);
      } else {
        const face = annoyedFaces[Math.floor(Math.random() * annoyedFaces.length)];
        this.showEmotion(face, 1800);
      }
    } else {
      // First many pokes — happy and laughing
      const face = happyFaces[Math.floor(Math.random() * happyFaces.length)];
      this.showEmotion(face, 1500);
    }
  }

  _fadeSearchGlow(on) {
    const eyes = [this.leftEye, this.rightEye];
    const body = this.avatarEl;
    const cheeks = [this.leftCheek, this.rightCheek];
    
    if (on) {
      // Fade IN: start with a subtle glow (instant), then ramp up to full bloom
      // Step 1: Apply initial subtle glow with NO transition (prevents harsh white flash)
      eyes.forEach(eye => {
        if (!eye) return;
        eye.style.transition = 'none';
        eye.style.background = 'radial-gradient(circle at 50% 50%, #d0eaff 0%, #000 100%)';
        eye.style.border = '2px solid rgba(130, 210, 255, 0.3)';
        eye.style.boxShadow = '0 0 4px 2px rgba(130,210,255,0.3), 0 0 10px 4px rgba(80,180,255,0.15)';
      });
      if (body) {
        body.style.transition = 'none';
      }
      // Step 2: After one frame, set transition and ramp to full glow
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        eyes.forEach(eye => {
          if (!eye) return;
          eye.style.transition = 'box-shadow 0.8s ease-in-out, background 0.6s ease-in-out, border 0.6s ease-in-out';
          eye.style.background = 'radial-gradient(circle at 50% 50%, #fff 0%, #fff 50%, #d0eaff 70%, #60bfff 100%)';
          eye.style.border = '2px solid rgba(130, 210, 255, 0.9)';
          eye.style.boxShadow = '0 0 10px 4px rgba(255,255,255,0.9), 0 0 25px 10px rgba(130,210,255,0.8), 0 0 50px 20px rgba(80,180,255,0.4), 0 0 80px 35px rgba(60,160,255,0.15)';
        });
        cheeks.forEach(c => { if (c) { c.style.transition = 'all 0.6s ease-in-out'; c.style.opacity = '0.4'; c.style.backgroundColor = '#80cfff'; }});
        if (body) {
          body.style.transition = 'box-shadow 0.8s ease-in-out';
          body.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1), 0 0 20px 8px rgba(130,210,255,0.3), 0 0 40px 15px rgba(80,180,255,0.15)';
        }
      }); });
      // Start the searching-glow animation after fade-in
      this._searchGlowAnim = setTimeout(() => {
        eyes.forEach(eye => { if (eye) eye.classList.add('searching'); });
        if (body) body.classList.add('searching');
        cheeks.forEach(c => { if (c) c.classList.add('searching'); });
      }, 900);
    } else {
      // Fade OUT: lock in glow as inline, remove class, then transition to normal
      if (this._searchGlowAnim) { clearTimeout(this._searchGlowAnim); this._searchGlowAnim = null; }
      
      // Step 1: Set glow as inline styles (so removing class doesn't snap)
      eyes.forEach(eye => {
        if (!eye) return;
        eye.style.transition = 'none';
        eye.style.background = 'radial-gradient(circle at 50% 50%, #fff 0%, #fff 50%, #d0eaff 70%, #60bfff 100%)';
        eye.style.border = '2px solid rgba(130, 210, 255, 0.9)';
        eye.style.boxShadow = '0 0 10px 4px rgba(255,255,255,0.9), 0 0 25px 10px rgba(130,210,255,0.8), 0 0 50px 20px rgba(80,180,255,0.4), 0 0 80px 35px rgba(60,160,255,0.15)';
      });
      // Now safe to remove class — inline styles hold the glow
      eyes.forEach(eye => { if (eye) eye.classList.remove('searching'); });
      cheeks.forEach(c => { if (c) c.classList.remove('searching'); });
      if (body) { body.classList.remove('searching'); }
      
      // Step 2: Next frame, set transition and clear to normal
      requestAnimationFrame(() => { requestAnimationFrame(() => {
        eyes.forEach(eye => {
          if (!eye) return;
          eye.style.transition = 'box-shadow 0.8s ease-in-out, background 0.6s ease-in-out, border 0.6s ease-in-out';
          eye.style.background = '';
          eye.style.border = '';
          eye.style.boxShadow = '';
        });
        cheeks.forEach(c => { if (c) { c.style.transition = 'all 0.6s ease-in-out'; c.style.opacity = ''; c.style.backgroundColor = ''; }});
        if (body) {
          body.style.transition = 'box-shadow 0.8s ease-in-out, background-color 0.5s ease, transform 0.3s ease';
          body.style.boxShadow = '';
        }
      }); });
      
      // Nuclear cleanup: force-remove everything after transitions complete
      setTimeout(() => {
        eyes.forEach(eye => {
          if (!eye) return;
          eye.style.transition = '';
          eye.style.background = '';
          eye.style.border = '';
          eye.style.boxShadow = '';
          eye.classList.remove('searching');
        });
        cheeks.forEach(c => { if (c) { c.style.transition = ''; c.style.opacity = ''; c.style.backgroundColor = ''; c.classList.remove('searching'); }});
        if (body) { body.style.transition = ''; body.style.boxShadow = ''; body.classList.remove('searching'); }
        this._clearExpressionClasses();
      }, 1200);
    }
  }

  _startEmotionCycle() {
    // Don't start if already cycling
    if (this._emotionCycleActive) return;
    this._emotionCycleActive = true;
    
    const emotions = ['happy', 'smiling', 'laughing', 'surprised', 'excited', 'confused', 'skeptical', 'sad', 'angry'];
    
    const cycleNext = () => {
      if (!this._emotionCycleActive) return;
      
      // 60% chance to show an emotion, 40% stay neutral for variety
      if (Math.random() < 0.6) {
        const emotion = emotions[Math.floor(Math.random() * emotions.length)];
        const duration = 2000 + Math.floor(Math.random() * 3000); // 2-5s
        this.showEmotion(emotion, duration);
        
        // Schedule next cycle after this emotion + cooldown
        const cooldown = 300 + Math.floor(Math.random() * 2700); // 0.3-3s
        this._emotionCycleTimer = setTimeout(cycleNext, duration + cooldown);
      } else {
        // Neutral pause, then try again
        const pause = 1000 + Math.floor(Math.random() * 2000); // 1-3s neutral
        this._emotionCycleTimer = setTimeout(cycleNext, pause);
      }
    };
    
    // Start after a short delay
    this._emotionCycleTimer = setTimeout(cycleNext, 500 + Math.floor(Math.random() * 1500));
    console.log('🎭 Emotion cycling started');
  }

  _stopEmotionCycle() {
    this._emotionCycleActive = false;
    if (this._emotionCycleTimer) {
      clearTimeout(this._emotionCycleTimer);
      this._emotionCycleTimer = null;
    }
    this.cancelEmotionSchedule();
    // Clear any active expression
    this._clearExpressionClasses();
    console.log('🎭 Emotion cycling stopped');
  }

  _initEmotionObserver() {
    const self = this;
    
    // Approach 1: Watch the chat DOM for new assistant messages
    const startObserver = () => {
      const output = document.getElementById('output');
      if (!output) {
        // Retry until the output element exists
        setTimeout(startObserver, 1000);
        return;
      }
      
      let debounceTimer = null;
      let lastProcessedText = '';
      
      const observer = new MutationObserver(() => {
        // Debounce: wait for text to stop changing (streaming finished)
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // Grab the last assistant message text
          const msgs = output.querySelectorAll('.message.assistant .message-content');
          if (!msgs.length) return;
          const lastMsg = msgs[msgs.length - 1];
          const text = (lastMsg.textContent || '').trim();
          
          // Only process if it's new and substantial
          if (text.length > 20 && text !== lastProcessedText) {
            lastProcessedText = text;
            console.log('🎭 [Observer] New assistant message detected, running emotion detection...');
            self._detectAndPlayEmotions(text);
          }
        }, 2000); // Wait 2s after last DOM change (streaming done)
      });
      
      observer.observe(output, { childList: true, subtree: true, characterData: true });
      console.log('🎭 Emotion observer started on #output');
    };
    
    startObserver();
    
    // Approach 2: Also trigger when voice playback stops
    const origHandleVoice = this.handleVoiceStatus.bind(this);
    this.handleVoiceStatus = (status) => {
      origHandleVoice(status);
      // When voice stops, grab last assistant message and detect emotions
      if (status === 'stopped' || status === 'ended' || status === 'idle') {
        setTimeout(() => {
          const output = document.getElementById('output');
          if (!output) return;
          const msgs = output.querySelectorAll('.message.assistant .message-content');
          if (!msgs.length) return;
          const text = (msgs[msgs.length - 1].textContent || '').trim();
          if (text.length > 20) {
            console.log('🎭 [Voice ended] Running emotion detection...');
            self._detectAndPlayEmotions(text);
          }
        }, 500);
      }
    };
  }

  _detectAndPlayEmotions(text) {
    // 70% chance to trigger (natural randomness)
    if (Math.random() > 0.70) return;
    
    const scores = this._detectEmotions(text);
    if (!Object.keys(scores).length) return;
    
    const result = this._buildEmotionSchedule(scores);
    if (!result) return;
    
    console.log(`🎭 Emotions detected — dominant: ${result.dominant}, schedule: ${result.schedule.map(s => s.emotion).join(' → ')}`);
    this.playEmotionSchedule(result.schedule);
  }

  // Cancel any running emotion schedule
  cancelEmotionSchedule() {
    if (this._emotionScheduleTimeouts) {
      for (const t of this._emotionScheduleTimeouts) {
        clearTimeout(t);
      }
      this._emotionScheduleTimeouts = [];
    }
  }
  
  // Look around animation
  lookAround() {
    console.log('Looking around');
    
    const leftStart = parseInt(window.getComputedStyle(this.leftEye).left);
    const rightStart = parseInt(window.getComputedStyle(this.rightEye).right);
    
    // Look right
    this.leftEye.style.left = (leftStart + 5) + 'px';
    this.rightEye.style.right = (rightStart + 5) + 'px';
    
    setTimeout(() => {
      // Look left
      this.leftEye.style.left = (leftStart - 5) + 'px';
      this.rightEye.style.right = (rightStart - 5) + 'px';
      
      setTimeout(() => {
        // Reset
        this.leftEye.style.left = '';
        this.rightEye.style.right = '';
      }, 800);
    }, 800);
  }
  
  // Bounce animation
  bounce() {
    console.log('Bouncing');
    
    // Stop any existing animations
    this.avatarEl.style.animation = 'none';
    
    // Trigger reflow
    void this.avatarEl.offsetWidth;
    
    // Start bounce animation
    this.avatarEl.style.animation = 'bounce 1.2s ease-in-out';
    
    // Add landing effect when bounce completes
    setTimeout(() => {
      this.avatarEl.style.animation = 'landing 0.5s ease-in-out';
      
      // Return to normal floating animation
      setTimeout(() => {
        this.avatarEl.style.animation = 'float 6s ease-in-out infinite';
      }, 500);
    }, 1200);
  }
  
  // Wiggle animation
  wiggle() {
    console.log('Wiggling');
    
    // Stop any existing animations
    this.avatarEl.style.animation = 'none';
    
    // Trigger reflow
    void this.avatarEl.offsetWidth;
    
    // Start wiggle animation
    this.avatarEl.style.animation = 'wiggle 0.5s ease-in-out';
    
    // Return to normal floating animation
    setTimeout(() => {
      this.avatarEl.style.animation = 'float 6s ease-in-out infinite';
    }, 500);
  }
  
  // Jiggle animation
  jiggle() {
    console.log('Jiggling');
    
    // Stop any existing animations
    this.avatarEl.style.animation = 'none';
    
    // Trigger reflow
    void this.avatarEl.offsetWidth;
    
    // Start jiggle animation
    this.avatarEl.style.animation = 'jiggle 0.8s ease-in-out';
    
    // Return to normal floating animation
    setTimeout(() => {
      this.avatarEl.style.animation = 'float 6s ease-in-out infinite';
    }, 800);
  }
  
  // Jump and bounce animation sequence
  jumpAndBounce() {
    console.log('Jumping and bouncing');
    
    // First jump high
    this.bounce();
    
    // After landing, do a little jiggle
    setTimeout(() => {
      this.jiggle();
    }, 1700);
  }
  
  // Squish animation
  squish() {
    console.log('Squishing');
    
    // Stop any existing animations
    this.avatarEl.style.animation = 'none';
    
    // Trigger reflow
    void this.avatarEl.offsetWidth;
    
    // Start squish animation
    this.avatarEl.style.animation = 'squish 0.5s ease-in-out';
    
    // Return to normal floating animation
    setTimeout(() => {
      this.avatarEl.style.animation = 'float 6s ease-in-out infinite';
    }, 500);
  }
  
  // Roll animation
  roll() {
    console.log('Rolling');
    
    // Stop any existing animations
    this.avatarEl.style.animation = 'none';
    
    // Trigger reflow
    void this.avatarEl.offsetWidth;
    
    // Start roll animation
    this.avatarEl.style.animation = 'roll 1s ease-in-out';
    
    // Return to normal floating animation
    setTimeout(() => {
      this.avatarEl.style.animation = 'float 6s ease-in-out infinite';
    }, 1000);
  }
  
  // 3D Rotation animation
  rotate3D() {
    // Don't start if already rotating or another animation is active
    if (this.isRotating || this.isAnimating) return;
    
    try {
      console.log('Starting 3D rotation animation');
      
      // Set flags
      this.isRotating = true;
      this.isAnimating = true;
      this._activeAnimations.add('rotate3D');
      
      // Store original transform
      const originalTransform = this.avatarEl.style.transform || '';
      
      // Get references to facial elements
      const eyes = this.avatarEl.querySelectorAll('.eye');
      const mouth = this.avatarEl.querySelector('.mouth');
      const cheeks = this.avatarEl.querySelectorAll('.cheek');
      
      // Store original mouth position
      const originalMouthLeft = mouth.style.left;
      const originalMouthTransform = mouth.style.transform;
      
      // Add the rotating class to trigger CSS animations for most elements
      this.avatarEl.classList.add('rotating');
      
      // Manually animate the mouth
      // Phase 1: Move left and fade
      setTimeout(() => {
        mouth.style.transition = 'all 0.1s ease-in-out';
        mouth.style.transform = 'translateX(-80%)';
        mouth.style.opacity = '0.7';
      }, 0);
      
      // Phase 2: Jump to right side and become nearly invisible
      setTimeout(() => {
        mouth.style.transition = 'opacity 0.05s ease-in-out';
        mouth.style.transform = 'translateX(0%)';
        mouth.style.opacity = '0';
      }, 100);
      
      // Phase 3: Start becoming visible on right side
      setTimeout(() => {
        mouth.style.transition = 'all 0.1s ease-in-out';
        mouth.style.opacity = '0.7';
      }, 150);
      
      // Phase 4: Return to original position
      setTimeout(() => {
        mouth.style.transform = originalMouthTransform || 'translateX(-50%)';
        mouth.style.opacity = '1';
      }, 250);
      
      // Store all timeouts for cleanup
      const timeouts = [];
      
      // Remove the class after animation completes
      const finalTimeout = setTimeout(() => {
        this.avatarEl.classList.remove('rotating');
        mouth.style.transition = '';
        
        // Reset flags
        this.isRotating = false;
        this.isAnimating = false;
        this._activeAnimations.delete('rotate3D');
        
        console.log('3D rotation animation completed');
      }, 300); // Match the animation duration in CSS (0.3 seconds)
      
      // Store the timeout for cleanup
      this._animationTimeouts.push(finalTimeout);
      
      // Set a safety timeout to ensure flags are reset
      const safetyTimeout = setTimeout(() => {
        if (this.isRotating) {
          console.log('Rotation safety timeout triggered');
          this.avatarEl.classList.remove('rotating');
          mouth.style.transition = '';
          
          // Reset flags
          this.isRotating = false;
          this.isAnimating = false;
          this._activeAnimations.delete('rotate3D');
        }
      }, 1000); // 1 second safety timeout
      
      // Store the safety timeout for cleanup
      this._animationTimeouts.push(safetyTimeout);
      
    } catch (error) {
      console.error('Error in rotate3D:', error);
      
      // Reset flags on error
      this.isRotating = false;
      this.isAnimating = false;
      this._activeAnimations.delete('rotate3D');
      
      // Remove rotating class if there was an error
      if (this.avatarEl) {
        this.avatarEl.classList.remove('rotating');
      }
    }
  }
  
  // Easing function for smoother animations
  _easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  
  // Make the avatar draggable
  makeDraggable() {
    // Save reference to this for use in event handlers
    const self = this;
    let isDragging = false;
    let offsetX, offsetY;
    
    // Share dragging state globally
    window.isDraggingAvatar = false;
    
    // Enable pointer events for dragging
    this.container.style.pointerEvents = 'auto';
    
    // Store avatar position in localStorage if available
    const loadSavedPosition = () => {
      if (window.localStorage) {
        const savedX = localStorage.getItem('avatarX');
        const savedY = localStorage.getItem('avatarY');
        
        if (savedX !== null && savedY !== null) {
          self.container.style.position = 'fixed';
          self.container.style.left = savedX;
          self.container.style.top = savedY;
          self.container.style.right = 'auto';
          self.container.style.bottom = 'auto';
          self.container.style.transform = 'none';
          console.log(`Loaded saved position: X=${savedX}, Y=${savedY}`);
        } else {
          // Set initial position above and behind the chat bar
          self.container.style.position = 'fixed';
          self.container.style.bottom = '80px';  // Position above chat input
          self.container.style.left = '50%';     // Center horizontally
          self.container.style.transform = 'translateX(-50%)'; // Center adjustment
          self.container.style.right = 'auto';
          self.container.style.top = 'auto';
          console.log('Set initial position above chat bar');
        }
      }
    };
    
    // Save position to localStorage
    const savePosition = () => {
      if (window.localStorage) {
        localStorage.setItem('avatarX', self.container.style.left);
        localStorage.setItem('avatarY', self.container.style.top);
        console.log(`Saved position: X=${self.container.style.left}, Y=${self.container.style.top}`);
      }
    };
    
    // Load saved position
    loadSavedPosition();
    
    // Mouse/touch down event
    const handleStart = (e) => {
      console.log('Avatar clicked:', e.target);
      
      // Update last interaction time
      this.lastInteractionTime = Date.now();
      
      // Prevent default only for touch events to avoid issues
      if (e.type === 'touchstart') {
        e.preventDefault();
      }
      
      // Get avatar container bounds
      const rect = self.container.getBoundingClientRect();
      
      // Calculate offset from click/touch point to avatar top-left corner
      if (e.type === 'mousedown') {
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
      } else {
        offsetX = e.touches[0].clientX - rect.left;
        offsetY = e.touches[0].clientY - rect.top;
      }
      
      isDragging = true;
      window.isDraggingAvatar = true;
      self._lastDragX = clientX || 0;
      self._lastDragY = clientY || 0;
      self._dragVelocity = 0;
      self._shakeCount = 0;
      
      // Disable transitions and transforms while dragging
      self.container.style.transition = 'none';
      self.container.style.transform = 'none';
      
      // React to being grabbed — mostly surprised/laughing
      const grabFaces = ['surprised', 'laughing', 'laughing', 'excited', 'confused'];
      self.showEmotion(grabFaces[Math.floor(Math.random() * grabFaces.length)], 2000);
      
      // Prevent any keyboard shortcuts from triggering
      e.stopPropagation();
    };
    
    // Mouse/touch move event
    const handleMove = (e) => {
      if (!isDragging) return;
      
      // Prevent default only for touch events to avoid issues
      if (e.type === 'touchmove') {
        e.preventDefault();
      }
      
      // Prevent any keyboard shortcuts from triggering
      e.stopPropagation();
      
      let clientX, clientY;
      if (e.type === 'mousemove') {
        clientX = e.clientX;
        clientY = e.clientY;
      } else {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      }
      
      // Calculate velocity for jiggle
      const dx = clientX - (self._lastDragX || clientX);
      const dy = clientY - (self._lastDragY || clientY);
      const speed = Math.sqrt(dx * dx + dy * dy);
      
      // Detect direction reversals (shaking)
      const dirX = Math.sign(dx);
      if (self._lastDragDirX && dirX !== 0 && dirX !== self._lastDragDirX) {
        self._shakeCount = (self._shakeCount || 0) + 1;
      }
      if (dirX !== 0) self._lastDragDirX = dirX;
      
      self._lastDragX = clientX;
      self._lastDragY = clientY;
      
      // Jiggle rotation based on horizontal movement
      const jiggleAngle = Math.max(-25, Math.min(25, dx * 1.5));
      const squishY = Math.max(0.9, Math.min(1.1, 1 + dy * 0.003));
      const squishX = Math.max(0.9, Math.min(1.1, 1 + Math.abs(dx) * 0.002));
      self.avatarEl.style.transform = `rotate(${jiggleAngle}deg) scaleX(${squishX}) scaleY(${squishY})`;
      
      // React to shaking
      if (self._shakeCount >= 8 && !self._shakeReacted) {
        self._shakeReacted = true;
        if (Math.random() < 0.4) {
          self.showEmotion('angry', 2500);
        } else {
          self.showEmotion('laughing', 2000);
        }
      } else if (self._shakeCount >= 4 && self._shakeCount < 8 && !self._shakeReacted) {
        self._shakeReacted = true;
        const shakeFaces = ['confused', 'surprised', 'laughing'];
        self.showEmotion(shakeFaces[Math.floor(Math.random() * shakeFaces.length)], 1500);
      }
      // Reset shake reaction flag after a bit so they can trigger again
      if (self._shakeReacted && self._shakeCount % 6 === 0) {
        self._shakeReacted = false;
      }
      
      // Calculate new position
      let newLeft = clientX - offsetX;
      let newTop = clientY - offsetY;
      
      // Keep within window bounds
      newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - self.container.offsetWidth));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - self.container.offsetHeight));
      
      // Update position with fixed positioning
      self.container.style.position = 'fixed';
      self.container.style.left = newLeft + 'px';
      self.container.style.top = newTop + 'px';
      self.container.style.right = 'auto';
      self.container.style.bottom = 'auto';
    };
    
    // Mouse/touch up event
    const handleEnd = () => {
      if (isDragging) {
        isDragging = false;
        window.isDraggingAvatar = false;
        
        // Ensure transform is none to prevent positioning issues
        self.container.style.transform = 'none';
        
        // Springy settle: jiggle back to neutral
        self.avatarEl.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        self.avatarEl.style.transform = 'rotate(0deg) scaleX(1) scaleY(1)';
        
        savePosition();
        
        // Add a little landing animation when dropped
        setTimeout(() => {
          self.avatarEl.style.transition = '';
          self.avatarEl.style.transform = '';
          self.avatarEl.style.animation = 'landing 0.5s ease-in-out';
        }, 400);
        
        // Return to normal floating animation
        setTimeout(() => {
          self.avatarEl.style.animation = 'float 6s ease-in-out infinite, body-bloom 25s linear infinite';
        }, 900);
        
        // Reset shake tracking
        self._shakeCount = 0;
        self._shakeReacted = false;
        self._lastDragDirX = 0;
      }
    };
    
    // Add event listeners
    this.avatarEl.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    
    // Touch events for mobile
    this.avatarEl.addEventListener('touchstart', handleStart, { passive: false });
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    
    // Double-click reaction — no position reset, just a face
    this.avatarEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.lastInteractionTime = Date.now();
      this._pokeReaction();
    });
    
    console.log('Avatar is now draggable');
  }
  
  trackCursor(e) {
    try {
      // Skip if we're in the middle of a rotation
      if (this.isRotating) return;
      
      // Calculate the center of the avatar
      const avatarRect = this.avatarEl.getBoundingClientRect();
      const avatarCenterX = avatarRect.left + avatarRect.width / 2;
      const avatarCenterY = avatarRect.top + avatarRect.height / 2;
      
      // Calculate the distance from the cursor to the center of the avatar
      const distanceX = e.clientX - avatarCenterX;
      const distanceY = e.clientY - avatarCenterY;
      
      // Calculate the distance as a percentage of the window size
      const percentX = distanceX / window.innerWidth * 100;
      const percentY = distanceY / window.innerHeight * 100;
      
      // Limit the movement range
      const maxEyeMovement = 3; // Reduced from 5 to 3 pixels for less elongated look
      const eyeMovementX = Math.max(-maxEyeMovement, Math.min(maxEyeMovement, percentX / 2));
      const eyeMovementY = Math.max(-maxEyeMovement, Math.min(maxEyeMovement, percentY / 2));
      
      // Move the eyes with smooth transition
      const leftEye = this.avatarEl.querySelector('.left-eye');
      const rightEye = this.avatarEl.querySelector('.right-eye');
      
      if (leftEye && rightEye) {
        // Store tracking values as CSS variables so expressions can incorporate them
        this.avatarEl.style.setProperty('--track-x', `${eyeMovementX}px`);
        this.avatarEl.style.setProperty('--track-y', `${eyeMovementY}px`);
        
        // Only apply direct transform if no expression class is active on the eyes
        const hasExpression = AnimatedAvatar.EXPRESSION_CLASSES.some(cls => leftEye.classList.contains(cls));
        if (!hasExpression) {
          leftEye.style.transition = 'transform 0.2s ease-out';
          rightEye.style.transition = 'transform 0.2s ease-out';
          leftEye.style.transform = `translate(${eyeMovementX}px, ${eyeMovementY}px)`;
          rightEye.style.transform = `translate(${eyeMovementX}px, ${eyeMovementY}px)`;
        }
      }
      
      // Move the cheeks slightly (less than the eyes)
      const leftCheek = this.avatarEl.querySelector('.left-cheek');
      const rightCheek = this.avatarEl.querySelector('.right-cheek');
      
      if (leftCheek && rightCheek) {
        const cheekMovementX = eyeMovementX * 0.5;
        const cheekMovementY = eyeMovementY * 0.5;
        
        leftCheek.style.transition = 'transform 0.25s ease-out';
        rightCheek.style.transition = 'transform 0.25s ease-out';
        leftCheek.style.transform = `translate(${cheekMovementX}px, ${cheekMovementY}px)`;
        rightCheek.style.transform = `translate(${cheekMovementX}px, ${cheekMovementY}px)`;
      }
      
      // Move the mouth slightly (less than the eyes, but more than cheeks)
      const mouth = this.avatarEl.querySelector('.mouth');
      if (mouth) {
        const mouthMovementX = eyeMovementX * 0.8; // Increased for smoother movement
        const mouthMovementY = eyeMovementY * 0.5; // Reduced for smoother movement
        
        mouth.style.transition = 'transform 0.3s ease-out';
        
        // Get current transform for talking mouth
        if (mouth.classList.contains('talking')) {
          // If talking, preserve the current height animation but add tracking
          // For talking mouths, we only apply horizontal movement
          mouth.style.transform = `translateX(calc(-50% + ${mouthMovementX}px))`;
        } else {
          // If not talking, apply both horizontal and vertical tracking
          mouth.style.transform = `translateX(calc(-50% + ${mouthMovementX}px)) translateY(${mouthMovementY}px)`;
        }
      }
      
      // Tilt the body slightly toward the cursor
      // Only tilt if the cursor is far enough from the center to warrant a response
      const tiltThreshold = 30; // Increased threshold to reduce jitter
      const maxTilt = 3; // Reduced maximum tilt for subtler effect
      
      if (Math.abs(percentX) > tiltThreshold || Math.abs(percentY) > tiltThreshold) {
        // Calculate tilt angles based on cursor position
        const tiltX = Math.max(-maxTilt, Math.min(maxTilt, -percentY / 15)); // Reduced tilt factor
        const tiltY = Math.max(-maxTilt, Math.min(maxTilt, percentX / 15)); // Reduced tilt factor
        
        // Apply the tilt with a smooth transition
        this.avatarEl.style.transition = 'transform 0.5s ease-out'; // Increased transition time
        this.avatarEl.style.transform = `perspective(300px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
        
        // Update the last interaction time
        this.lastInteractionTime = Date.now();
      }
      
      // Update the last interaction time
      this.lastInteractionTime = Date.now();
    } catch (error) {
      console.error('Error tracking cursor:', error);
    }
  }
  
  startRandomBehaviors() {
    try {
      // Clear any existing random behavior interval
      if (this._randomBehaviorsInterval) {
        clearInterval(this._randomBehaviorsInterval);
        this._randomBehaviorsInterval = null;
      }
      
      // Schedule blinking
      this.scheduleNextBlink();
      
      // Steady color heartbeat — broadcast current color to backend every 3s
      this._colorHeartbeat = setInterval(() => {
        try {
          if (!this.avatarEl) return;
          const bc = getComputedStyle(this.avatarEl).getPropertyValue('--avatar-body-color').trim();
          const fc = getComputedStyle(this.avatarEl).getPropertyValue('--avatar-face-color').trim();
          if (bc) fetch((window.proxyBase || 'http://localhost:8765') + '/api/ui/color', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({body: bc, face: fc}) }).catch(()=>{});
        } catch(_){}
      }, 3000);

      // Random behaviors on a timer
      this._randomBehaviorsInterval = setInterval(() => {
        // Color cycling runs independently of movement (works in hero mode too)
        try {
          if (this.colorBehavior && 
              this.colorBehavior.autonomousChanging && 
              Math.random() < 0.15 && 
              !this.colorTransitionActive) {
            this.transitionToRandomColorSet();
          }
        } catch(_) {}

        // Only do random behaviors if we haven't had user interaction recently
        // and we're not already moving, talking, or in the middle of another animation
        const timeSinceLastInteraction = Date.now() - this.lastInteractionTime;
        if (timeSinceLastInteraction > 10000 && 
            this.autonomousMovementEnabled && 
            !this.isMoving && 
            !this.isAudioPlaying && 
            !this.isAnimating && 
            this.state === 'idle') {
          
          // Set animating flag to prevent overlapping animations
          this.isAnimating = true;
          
          try {
            const randomAction = Math.random();
            
            // Restore original probabilities for animations
            if (randomAction < 0.1) {
              this.lookAround();
            } else if (randomAction < 0.2) {
              this.wiggle();
            } else if (randomAction < 0.25) {
              this.bounce();
            } else if (randomAction < 0.3) {
              this.jiggle();
            } else if (randomAction < 0.32) {
              this.jumpAndBounce();
            } else if (randomAction < 0.34) {
              this.squish();
            } else if (randomAction < 0.36) {
              this.roll();
            } else if (randomAction < 0.38) {
              this.rotate3D();
            } else if (randomAction < 0.4) {
              this.waveArmsOnce(Math.random() < 0.3); // 30% chance of dramatic wave
            }
            
            // Reset animating flag after a safe delay
            setTimeout(() => {
              this.isAnimating = false;
            }, 2000); // 2 seconds should be enough for most animations to complete
          } catch (error) {
            console.error('Error in random behavior:', error);
            // Make sure to reset the animating flag even if there's an error
            this.isAnimating = false;
          }
        }
      }, 5000); // 5-second interval
      
      console.log('Random behaviors started');
    } catch (error) {
      console.error('Error in startRandomBehaviors:', error);
    }
  }
  
  // Color transition methods
  transitionToRandomColorSet() {
    try {
      if (!this.colorSets || this.colorSets.length <= 1 || this.colorTransitionActive) {
        return;
      }
      
      // Get a random color set different from the current one
      let newIndex;
      do {
        newIndex = Math.floor(Math.random() * this.colorSets.length);
      } while (newIndex === this.currentColorSetIndex);
      
      this.transitionToColorSet(newIndex);
    } catch (error) {
      console.error('Error in transitionToRandomColorSet:', error);
    }
  }
  
  transitionToColorSet(index) {
    try {
      if (!this.colorSets || index >= this.colorSets.length || this.colorTransitionActive) {
        return;
      }
      
      const startColorSet = this.colorSets[this.currentColorSetIndex];
      const endColorSet = this.colorSets[index];
      
      // Parse colors to RGB
      const startBodyColor = this.hexToRgb(startColorSet.body);
      const startFaceColor = this.hexToRgb(startColorSet.face);
      const endBodyColor = this.hexToRgb(endColorSet.body);
      const endFaceColor = this.hexToRgb(endColorSet.face);
      
      if (!startBodyColor || !startFaceColor || !endBodyColor || !endFaceColor) {
        console.error('Invalid color format in color sets');
        return;
      }
      
      // Set transition as active
      this.colorTransitionActive = true;
      
      // Random transition duration
      const minSpeed = this.colorBehavior.minTransitionSpeed || 500;
      const maxSpeed = this.colorBehavior.maxTransitionSpeed || 10000;
      const duration = Math.random() * (maxSpeed - minSpeed) + minSpeed;
      
      const startTime = Date.now();
      
      // Clear any existing transition
      if (this.colorTransitionInterval) {
        clearInterval(this.colorTransitionInterval);
      }
      
      // Start transition animation
      this.colorTransitionInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Calculate interpolated colors
        const bodyColor = this.interpolateColor(startBodyColor, endBodyColor, progress);
        const faceColor = this.interpolateColor(startFaceColor, endFaceColor, progress);
        
        // Apply colors
        this.avatarEl.style.setProperty('--avatar-body-color', bodyColor);
        this.avatarEl.style.setProperty('--avatar-face-color', faceColor);
        
        // Broadcast to backend for WebUI sync (throttled to ~2Hz)
        if (!this._lastColorBroadcast || elapsed - this._lastColorBroadcast > 500 || progress >= 1) {
          this._lastColorBroadcast = elapsed;
          try { fetch((window.proxyBase || 'http://localhost:8765') + '/api/ui/color', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({body: bodyColor, face: faceColor}) }).catch(()=>{}); } catch(_){}
        }
        
        // End transition when complete
        if (progress >= 1) {
          clearInterval(this.colorTransitionInterval);
          this.colorTransitionInterval = null;
          this.colorTransitionActive = false;
          this.currentColorSetIndex = index;
        }
      }, 16); // ~60fps
    } catch (error) {
      console.error('Error in transitionToColorSet:', error);
      this.colorTransitionActive = false;
    }
  }
  
  // Deterministic wall-clock color cycle — synced with WebUI
  startDeterministicColorCycle() {
    if (!this.colorSets || this.colorSets.length <= 1) return;
    if (!this.colorBehavior || !this.colorBehavior.autonomousChanging) return;
    if (this._deterministicColorRAF) return; // already running
    const TRANSITION_MS = 8000;
    const HOLD_MS = 25000;
    const CYCLE_MS = TRANSITION_MS + HOLD_MS;
    const sets = this.colorSets;
    const self = this;
    function tick() {
      try {
        const now = Date.now();
        const totalCycle = CYCLE_MS * sets.length;
        const pos = now % totalCycle;
        const idx = Math.floor(pos / CYCLE_MS) % sets.length;
        const slotPos = pos - (idx * CYCLE_MS);
        const next = (idx + 1) % sets.length;
        let bc, fc;
        if (slotPos < HOLD_MS) {
          bc = sets[idx].body; fc = sets[idx].face;
        } else {
          const t = (slotPos - HOLD_MS) / TRANSITION_MS;
          const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
          const fb = self.hexToRgb(sets[idx].body), ff = self.hexToRgb(sets[idx].face);
          const tb = self.hexToRgb(sets[next].body), tf = self.hexToRgb(sets[next].face);
          bc = self.interpolateColor(fb, tb, ease);
          fc = self.interpolateColor(ff, tf, ease);
        }
        if (self.avatarEl) {
          self.avatarEl.style.setProperty('--avatar-body-color', bc);
          self.avatarEl.style.setProperty('--avatar-face-color', fc);
        }
        self.currentColorSetIndex = idx;
      } catch(_) {}
      self._deterministicColorRAF = requestAnimationFrame(tick);
    }
    this._deterministicColorRAF = requestAnimationFrame(tick);
  }

  // Helper methods for color transitions
  hexToRgb(hex) {
    try {
      // Remove # if present
      hex = hex.replace(/^#/, '');
      
      // Parse hex to RGB
      const bigint = parseInt(hex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      
      return { r, g, b };
    } catch (error) {
      console.error('Error in hexToRgb:', error);
      return null;
    }
  }
  
  interpolateColor(color1, color2, factor) {
    try {
      // Linear interpolation between colors
      const r = Math.round(color1.r + factor * (color2.r - color1.r));
      const g = Math.round(color1.g + factor * (color2.g - color1.g));
      const b = Math.round(color1.b + factor * (color2.b - color1.b));
      
      // Convert back to hex
      return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
    } catch (error) {
      console.error('Error in interpolateColor:', error);
      return '#5bbfdd'; // Default color
    }
  }
  
  // Set the default color set index
  setDefaultColorSetIndex(index) {
    if (index >= 0 && index < this.colorSets.length) {
      this.defaultColorSetIndex = index;
      
      // Apply the default color set immediately
      const colorSet = this.colorSets[index];
      this.avatarEl.style.setProperty('--avatar-body-color', colorSet.body);
      this.avatarEl.style.setProperty('--avatar-face-color', colorSet.face);
      
      this.currentColorSetIndex = index;
    }
  }
  
  waveArmsOnce() {
    try {
      // Set flag to prevent multiple arm waves
      this.isWavingArms = true;
      
      // Get arm elements
      const leftArm = this.avatarEl.querySelector('.left-arm');
      const rightArm = this.avatarEl.querySelector('.right-arm');
      
      if (leftArm && rightArm) {
        // Dramatic arm wave
        const isDramatic = Math.random() < 0.3; // 30% chance of dramatic wave
        
        if (isDramatic) {
          // Dramatic wave with high position and wide spread
          leftArm.style.transition = 'all 0.3s ease-out';
          rightArm.style.transition = 'all 0.3s ease-out';
          
          leftArm.style.transform = 'rotate(-80deg) translateY(-8px)';
          rightArm.style.transform = 'rotate(80deg) translateY(-8px)';
          
          // Position arms higher
          leftArm.style.top = '30%';
          rightArm.style.top = '30%';
          
          // Position arms wider
          leftArm.style.left = '-8px';
          rightArm.style.right = '-8px';
        } else {
          // Regular wave with subtle movement
          leftArm.style.transition = 'all 0.2s ease-out';
          rightArm.style.transition = 'all 0.2s ease-out';
          
          leftArm.style.transform = 'rotate(-30deg)';
          rightArm.style.transform = 'rotate(30deg)';
        }
        
        // Reset arms after a delay
        setTimeout(() => {
          leftArm.style.transition = 'all 0.5s ease-out';
          rightArm.style.transition = 'all 0.5s ease-out';
          
          leftArm.style.transform = '';
          rightArm.style.transform = '';
          
          // Reset position if it was a dramatic wave
          if (isDramatic) {
            leftArm.style.top = '';
            rightArm.style.top = '';
            leftArm.style.left = '';
            rightArm.style.right = '';
          }
          
          // Reset flag
          this.isWavingArms = false;
        }, isDramatic ? 1500 : 800);
      }
    } catch (error) {
      console.error('Error in waveArmsOnce:', error);
      this.isWavingArms = false;
    }
  }
  
  // Start glowing eyes effect for web search
  startGlowingEyes() {
    console.log('%c 👁️ AVATAR: Starting glowing eyes!', 'background: #00ffff; color: #000; font-size: 16px;');
    try {
      const leftEye = this.avatarEl.querySelector('.left-eye');
      const rightEye = this.avatarEl.querySelector('.right-eye');
      
      if (leftEye && rightEye) {
        this._eyesGlowing = true;
        
        const applyGlow = (intense) => {
          const bgColor = intense ? '#ffffff' : '#aaffff';
          const shadowSize = intense ? '20px' : '12px';
          const shadowColor = intense ? 'rgba(255,255,255,1)' : 'rgba(200,255,255,0.8)';
          
          [leftEye, rightEye].forEach(eye => {
            eye.style.backgroundColor = bgColor;
            eye.style.boxShadow = `0 0 ${shadowSize} ${shadowSize} ${shadowColor}, 0 0 ${parseInt(shadowSize)*2}px ${parseInt(shadowSize)*2}px rgba(0,255,255,0.5)`;
            eye.style.transition = 'all 0.3s ease-in-out';
          });
        };
        
        // Initial glow
        applyGlow(true);
        
        // Pulse animation
        let intense = true;
        this._glowInterval = setInterval(() => {
          if (!this._eyesGlowing) return;
          applyGlow(intense);
          intense = !intense;
        }, 400);
      }
    } catch (error) {
      console.error('Error starting glowing eyes:', error);
    }
  }
  
  // Stop glowing eyes effect
  stopGlowingEyes() {
    console.log('%c 👁️ AVATAR: Stopping glowing eyes', 'background: #ff6600; color: #fff;');
    try {
      this._eyesGlowing = false;
      
      if (this._glowInterval) {
        clearInterval(this._glowInterval);
        this._glowInterval = null;
      }
      
      const leftEye = this.avatarEl.querySelector('.left-eye');
      const rightEye = this.avatarEl.querySelector('.right-eye');
      
      if (leftEye && rightEye) {
        [leftEye, rightEye].forEach(eye => {
          eye.style.backgroundColor = '';
          eye.style.boxShadow = '';
          eye.style.transition = '';
        });
      }
    } catch (error) {
      console.error('Error stopping glowing eyes:', error);
    }
  }
  
  blink() {
    try {
      const leftEye = this.avatarEl.querySelector('.left-eye');
      const rightEye = this.avatarEl.querySelector('.right-eye');
      
      if (leftEye && rightEye) {
        // Close eyes
        leftEye.style.height = '1px';
        rightEye.style.height = '1px';
        
        // Open eyes after a short delay
        setTimeout(() => {
          leftEye.style.height = '';
          rightEye.style.height = '';
        }, 150);
      }
    } catch (error) {
      console.error('Error in blink animation:', error);
    }
  }
  
  scheduleNextBlink() {
    // Clear any existing blink timeout
    if (this.blinkTimeout) {
      clearTimeout(this.blinkTimeout);
    }
    
    // Random interval between 4000-9000ms (4-9 seconds)
    const nextBlinkTime = 4000 + Math.random() * 5000;
    
    this.blinkTimeout = setTimeout(() => {
      try {
        // Skip if we're in the middle of a rotation
        if (this.isRotating) {
          this.scheduleNextBlink();
          return;
        }
        
        // Perform the blink
        this.blink();
        
        // Schedule the next blink
        this.scheduleNextBlink();
      } catch (error) {
        console.error('Error in scheduled blink:', error);
        // If there's an error, still try to schedule the next blink
        this.scheduleNextBlink();
      }
    }, nextBlinkTime);
  }
}

// Initialize avatar when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Immediately add a style to ensure mouth is closed by default
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .mouth {
      height: 2px !important;
      transition: height 0.1s ease-in-out;
    }
  `;
  document.head.appendChild(styleEl);
  
  // Wait a short time to ensure all elements are loaded
  setTimeout(() => {
    window.avatar = new AnimatedAvatar('avatar-container');
    console.log('Animated avatar initialized');
    
    // Force mouth to be closed again after initialization
    if (window.avatar && window.avatar.mouth) {
      // Apply CSS variables instead of direct style
      const mouthWidth = getComputedStyle(window.avatar.avatarEl).getPropertyValue('--mouth-width').trim() || '21px';
      const mouthHeight = getComputedStyle(window.avatar.avatarEl).getPropertyValue('--mouth-height').trim() || '2px';
      
      // Set CSS variables
      window.avatar.avatarEl.style.setProperty('--mouth-width', mouthWidth);
      window.avatar.avatarEl.style.setProperty('--mouth-height', mouthHeight);
      
      // Ensure closed state is properly applied
      window.avatar.mouth.style.transition = 'height 0.1s ease-in-out';
      
      // Add a class to indicate the mouth is closed
      window.avatar.mouth.classList.add('mouth-closed');
    }
    
    // Expose the avatar to the global scope for debugging
    window.debugAvatar = () => {
      console.log('Avatar state:', window.avatar.state);
      console.log('Is audio playing:', window.avatar.isAudioPlaying);
      console.log('Talk interval active:', !!window.avatar.talkInterval);
      console.log('Blink interval active:', !!window.avatar.blinkInterval);
      console.log('Mouth element:', window.avatar.mouth);
      console.log('Mouth classes:', window.avatar.mouth.className);
      console.log('Mouth style:', window.avatar.mouth.style.cssText);
    };
    
    // Demo: cycle through all expressions — call window.demoExpressions() from DevTools
    window.demoExpressions = function() {
      if (!window.avatar) { console.error('No avatar'); return; }
      const emotions = ['happy', 'smiling', 'surprised', 'confused', 'angry', 'sad', 'laughing', 'skeptical', 'sleepy', 'excited', 'searching'];
      let i = 0;
      const next = () => {
        if (i >= emotions.length) { console.log('Demo complete!'); return; }
        const em = emotions[i];
        console.log(`▶ ${em}`);
        window.avatar.showEmotion(em, 2500);
        i++;
        setTimeout(next, 3000);
      };
      next();
    };
    console.log('💡 Run window.demoExpressions() to preview all faces');

    // Register with API if available
    if (window.api && window.api.receive) {
      window.api.receive('voice-status', (status) => {
        console.log('Voice status received from API in avatar.js:', status);
        if (window.avatar) {
          window.avatar.handleVoiceStatus(status);
        }
      });
      console.log('Registered voice-status handler with API');
    }
  }, 500);
});
