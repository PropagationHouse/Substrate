# Aurora Forecast Functionality

This document details the Aurora Forecast functionality in Tiny Pirate, which is the only weather-related feature that remains in the application.

## Overview

The Aurora Forecast feature allows users to check current and predicted aurora borealis (northern lights) activity using natural language queries. When detected, the system opens the NOAA Space Weather Prediction Center's 30-minute aurora forecast page in the default web browser.

## Supported Commands

Users can trigger the aurora forecast functionality using natural language queries such as:

- "show aurora forecast"
- "check aurora borealis"
- "aurora prediction"
- "show me the northern lights"
- "aurora map"
- "check aurora"
- "show me aurora"
- "show the aurora"
- "show me the aurora"
- "northern lights"
- "aurora borealis"

## Implementation Details

### Command Detection

Aurora commands are detected through pattern matching in the main process:

```javascript
// Check for aurora forecast commands
const auroraTerms = ['aurora forecast', 'aurora map', 'show aurora', 'check aurora', 'aurora prediction', 
                   'show me aurora', 'show the aurora', 'show me the aurora', 'northern lights', 'aurora borealis'];

// Check if this is an aurora-related command
const textLower = data.text.toLowerCase();
for (const term of auroraTerms) {
    if (textLower.includes(term)) {
        isAuroraCommand = true;
        console.log(`[DEBUG] Detected aurora command: ${term} in text: ${data.text}`);
        break;
    }
}
```

### Command Handling

Aurora commands are processed by the `_handle_weather_command` method in the CommandParser class:

```python
def _handle_weather_command(self, query, location):
    """Weather functionality has been removed. Only aurora forecast is supported."""
    # Only handle aurora forecast queries
    if 'aurora' in query.lower() and ('forecast' in query.lower() or 'show' in query.lower() or 'check' in query.lower()):
        return {'type': 'search', 'query': query.strip(), 'source': 'aurora'}
    # All other weather queries are disabled
    return None
```

### Command Execution

When an aurora command is detected, the system opens the NOAA Space Weather Prediction Center's aurora forecast page:

```python
def execute_aurora_command(self, command):
    """Execute aurora forecast commands"""
    query = command.get('query', '')
    
    try:
        # Open aurora forecast website
        url = "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast"
        webbrowser.open(url)
        
        return {
            'status': 'success',
            'result': f"Opening aurora forecast for your viewing. The aurora forecast shows the current and predicted aurora activity."
        }
    except Exception as e:
        return {
            'status': 'error',
            'result': f"Error accessing aurora forecast: {str(e)}"
        }
```

## Important Notes

1. **Weather Functionality Removed**: All general weather functionality has been removed from the application. Only aurora forecast commands are supported.

2. **External Website**: The aurora forecast is displayed by opening an external website (NOAA Space Weather Prediction Center) in the default web browser.

3. **Internet Connection Required**: An active internet connection is required to access the aurora forecast.

## Troubleshooting

- **Browser doesn't open**: Ensure that a default web browser is set on your system.
- **Website doesn't load**: Check your internet connection and try again.
- **Command not recognized**: Make sure to use one of the supported command phrases listed above.

## Future Enhancements

Potential future enhancements for the aurora forecast functionality could include:

- Embedding the aurora forecast directly in the application UI
- Adding location-specific aurora predictions
- Providing aurora activity alerts based on user-defined thresholds
- Integrating with additional aurora forecast data sources
