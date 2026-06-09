with open(r'C:\Users\Bl0ck\CascadeProjects\windsurf-project\static\planning_mood.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Better syntax check - track braces per line, ignoring strings and comments
# Focus around lines 540-600 where the _doFitMoodBoard changes were made
for i in range(535, min(610, len(lines))):
    line = lines[i].rstrip()
    print(f"{i+1:4d}: {line[:120]}")
