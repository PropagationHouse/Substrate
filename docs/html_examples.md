# HTML Visualization Examples for Tiny Pirate

These examples can be used with the new HTML rendering capability in the chat interface. Simply copy and paste these examples into the chat to see them rendered.

## 1. Glowing Orb

```html
<style>
  .orb {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 0 20px 10px rgba(255, 255, 255, 0.7),
                0 0 40px 20px rgba(0, 255, 255, 0.5);
    margin: 50px auto;
    transition: box-shadow 0.5s ease;
  }
  
  .orb:hover {
    box-shadow: 0 0 20px 10px rgba(255, 255, 255, 0.7),
                0 0 40px 20px rgba(255, 0, 255, 0.5),
                0 0 60px 30px rgba(0, 0, 255, 0.3);
  }
  
  .container {
    background: #111;
    padding: 20px;
    border-radius: 10px;
    text-align: center;
  }
  
  .title {
    color: white;
    font-family: Arial, sans-serif;
    margin-bottom: 20px;
  }
</style>

<div class="container">
  <h3 class="title">Interactive Glowing Orb</h3>
  <div class="orb"></div>
  <p style="color: #aaa; font-size: 14px;">Hover over the orb to see it change color</p>
</div>
```

## 2. Simple Image Slideshow

```html
<style>
  .slideshow-container {
    max-width: 500px;
    position: relative;
    margin: auto;
    background: #222;
    padding: 20px;
    border-radius: 10px;
  }
  
  .slide {
    display: none;
    text-align: center;
  }
  
  .slide.active {
    display: block;
  }
  
  .slide-img {
    width: 100%;
    height: 200px;
    background-color: #444;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 24px;
    border-radius: 5px;
  }
  
  .prev, .next {
    cursor: pointer;
    position: absolute;
    top: 50%;
    width: auto;
    margin-top: -30px;
    padding: 16px;
    color: white;
    font-weight: bold;
    font-size: 18px;
    border-radius: 0 3px 3px 0;
    user-select: none;
    background: rgba(0,0,0,0.5);
    border: none;
  }
  
  .next {
    right: 20px;
    border-radius: 3px 0 0 3px;
  }
  
  .prev {
    left: 20px;
  }
  
  .prev:hover, .next:hover {
    background-color: rgba(0,0,0,0.8);
  }
  
  .caption {
    color: #f2f2f2;
    font-size: 15px;
    padding: 8px 0;
    text-align: center;
  }
</style>

<div class="slideshow-container">
  <div class="slide active">
    <div class="slide-img">Slide 1</div>
    <div class="caption">First slide description</div>
  </div>
  
  <div class="slide">
    <div class="slide-img">Slide 2</div>
    <div class="caption">Second slide description</div>
  </div>
  
  <div class="slide">
    <div class="slide-img">Slide 3</div>
    <div class="caption">Third slide description</div>
  </div>
  
  <button class="prev" onclick="changeSlide(-1)">❮</button>
  <button class="next" onclick="changeSlide(1)">❯</button>
</div>

<script>
  let slideIndex = 0;
  showSlide(slideIndex);
  
  function changeSlide(n) {
    showSlide(slideIndex += n);
  }
  
  function showSlide(n) {
    const slides = document.querySelectorAll('.slide');
    
    if (n >= slides.length) {slideIndex = 0}
    if (n < 0) {slideIndex = slides.length - 1}
    
    for (let i = 0; i < slides.length; i++) {
      slides[i].classList.remove('active');
    }
    
    slides[slideIndex].classList.add('active');
  }
</script>
```

## 3. Interactive Data Chart

```html
<style>
  .chart-container {
    background: #222;
    padding: 20px;
    border-radius: 10px;
    font-family: Arial, sans-serif;
  }
  
  .chart-title {
    color: white;
    text-align: center;
    margin-bottom: 20px;
  }
  
  .chart {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .bar-container {
    display: flex;
    align-items: center;
  }
  
  .label {
    width: 100px;
    color: white;
    text-align: right;
    padding-right: 10px;
  }
  
  .bar {
    height: 30px;
    background: linear-gradient(to right, #00ffff, #0088ff);
    border-radius: 5px;
    transition: width 0.5s ease;
    position: relative;
    min-width: 30px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 10px;
    color: white;
    font-weight: bold;
  }
  
  .controls {
    margin-top: 20px;
    display: flex;
    justify-content: center;
    gap: 10px;
  }
  
  button {
    background: #444;
    color: white;
    border: none;
    padding: 8px 15px;
    border-radius: 5px;
    cursor: pointer;
  }
  
  button:hover {
    background: #666;
  }
</style>

<div class="chart-container">
  <h3 class="chart-title">Interactive Data Visualization</h3>
  
  <div class="chart">
    <div class="bar-container">
      <div class="label">Data A</div>
      <div class="bar" style="width: 60%;">60%</div>
    </div>
    
    <div class="bar-container">
      <div class="label">Data B</div>
      <div class="bar" style="width: 80%;">80%</div>
    </div>
    
    <div class="bar-container">
      <div class="label">Data C</div>
      <div class="bar" style="width: 40%;">40%</div>
    </div>
  </div>
  
  <div class="controls">
    <button onclick="randomizeData()">Randomize Data</button>
    <button onclick="resetData()">Reset Data</button>
  </div>
</div>

<script>
  function randomizeData() {
    const bars = document.querySelectorAll('.bar');
    bars.forEach(bar => {
      const randomValue = Math.floor(Math.random() * 100) + 1;
      bar.style.width = randomValue + '%';
      bar.textContent = randomValue + '%';
    });
  }
  
  function resetData() {
    const bars = document.querySelectorAll('.bar');
    const defaultValues = [60, 80, 40];
    
    bars.forEach((bar, index) => {
      const value = defaultValues[index];
      bar.style.width = value + '%';
      bar.textContent = value + '%';
    });
  }
</script>
```

## 4. Animated Loading Spinner

```html
<style>
  .spinner-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #222;
    padding: 30px;
    border-radius: 10px;
  }
  
  .spinner {
    width: 80px;
    height: 80px;
    border: 8px solid rgba(0, 255, 255, 0.1);
    border-left-color: cyan;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .spinner-text {
    margin-top: 20px;
    color: cyan;
    font-family: Arial, sans-serif;
  }
</style>

<div class="spinner-container">
  <div class="spinner"></div>
  <div class="spinner-text">Loading...</div>
</div>
```

## 5. Interactive Button Effects

```html
<style>
  .button-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    background: #222;
    padding: 30px;
    border-radius: 10px;
    font-family: Arial, sans-serif;
  }
  
  .title {
    color: white;
    margin-bottom: 10px;
  }
  
  .button-row {
    display: flex;
    gap: 15px;
  }
  
  .fancy-button {
    padding: 12px 24px;
    border: none;
    border-radius: 5px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.3s ease;
    position: relative;
    overflow: hidden;
  }
  
  .neon {
    background: #111;
    color: #0ff;
    box-shadow: 0 0 5px #0ff, 0 0 10px #0ff;
  }
  
  .neon:hover {
    background: #0ff;
    color: #111;
    box-shadow: 0 0 10px #0ff, 0 0 20px #0ff, 0 0 40px #0ff;
  }
  
  .gradient {
    background: linear-gradient(45deg, #ff00ff, #00ffff);
    color: white;
  }
  
  .gradient:hover {
    background: linear-gradient(45deg, #00ffff, #ff00ff);
    transform: scale(1.05);
  }
  
  .pulse {
    background: #f06;
    color: white;
    animation: pulse 2s infinite;
  }
  
  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }
  
  .pulse:hover {
    animation: none;
    background: #f09;
    transform: scale(1.1);
  }
  
  .status {
    color: white;
    margin-top: 20px;
    height: 20px;
  }
</style>

<div class="button-container">
  <h3 class="title">Interactive Button Effects</h3>
  
  <div class="button-row">
    <button class="fancy-button neon" onclick="showStatus('Neon button clicked!')">Neon</button>
    <button class="fancy-button gradient" onclick="showStatus('Gradient button clicked!')">Gradient</button>
    <button class="fancy-button pulse" onclick="showStatus('Pulse button clicked!')">Pulse</button>
  </div>
  
  <div class="status" id="status"></div>
</div>

<script>
  function showStatus(message) {
    const status = document.getElementById('status');
    status.textContent = message;
    
    setTimeout(() => {
      status.textContent = '';
    }, 2000);
  }
</script>
```

## How to Use These Examples

1. Copy any of the HTML examples above
2. Paste it into the chat input
3. The HTML renderer will detect the HTML code and display it as an interactive visualization

You can also create your own HTML visualizations by following the same format. Just make sure to include the HTML code between the appropriate markers.
