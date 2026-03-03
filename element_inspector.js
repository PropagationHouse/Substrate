// ELEMENT INSPECTOR
// This script logs all form input elements when the config panel is visible
// But does so WITHOUT excessive console logging
console.log("📋 Element Inspector loaded");

let inspectionComplete = false;

function inspectElements() {
  // Don't run multiple times
  if (inspectionComplete) return;
  
  // Find all input elements
  const inputs = document.querySelectorAll('input, textarea, select');
  
  // Check if we have significant inputs (likely config panel is open)
  if (inputs.length > 5) {
    console.log("==== CONFIGURATION PANEL ELEMENTS ====");
    console.log(`Found ${inputs.length} input elements`);
    
    // Create a table of element details
    const elementDetails = [];
    
    inputs.forEach(el => {
      if (el.id) {
        const value = el.type === 'checkbox' ? el.checked : el.value;
        elementDetails.push({
          id: el.id,
          type: el.type,
          value: value,
          placeholder: el.placeholder || ''
        });
      }
    });
    
    // Log as table for easy reading
    console.table(elementDetails);
    
    // Mark as complete so we don't keep logging
    inspectionComplete = true;
    
    // Create a small notification to check the console
    const notification = document.createElement('div');
    notification.textContent = "✅ Element IDs logged to console. Please check there!";
    notification.style.position = 'fixed';
    notification.style.top = '10px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.backgroundColor = 'rgba(0,0,0,0.7)';
    notification.style.color = '#fff';
    notification.style.padding = '5px 10px';
    notification.style.borderRadius = '3px';
    notification.style.zIndex = '9999';
    notification.style.fontSize = '12px';
    document.body.appendChild(notification);
    
    // Auto-remove after 10 seconds
    setTimeout(() => notification.remove(), 10000);
  }
}

// Check for elements when the config panel might be visible
document.addEventListener('click', () => {
  // Reset the flag on clicks to allow for re-inspection when panel is opened
  inspectionComplete = false;
  // Wait a short bit for panel to render
  setTimeout(inspectElements, 1000);
});

// Check on initial load with a delay
setTimeout(inspectElements, 3000);
