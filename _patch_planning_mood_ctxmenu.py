import re

path = r"C:\Users\Bl0ck\CascadeProjects\windsurf-project\static\planning_mood.js"

with open(path, "r", encoding="utf-8") as f:
    s = f.read()

# 1) Add try/catch around context menu actions (where present)
needle_old = "            console.log('[CtxMenu] Clicked:', text, 'imageId:', imageId);\n            if (text.includes('Download'))           { downloadMoodImage(imageId); }\n            else if (text.includes('Generate Variation')) { showVariationSubmenu(imageId); }\n            else if (text.includes('Edit with AI'))  { showManualPromptUI(imageId, 'edit'); }\n            else if (text.includes('New from Ref'))  { showManualPromptUI(imageId, 'reference'); }\n            else if (text.includes('Rotate'))        { rotateMoodImage(imageId); }\n            else if (text.includes('Duplicate'))     { duplicateMoodImage(imageId); }\n            else if (text.includes('Delete'))        { deleteMoodImage(imageId); }"

needle_new = "            console.log('[CtxMenu] Clicked:', text, 'imageId:', imageId);\n            try {\n                if (text.includes('Download'))                { downloadMoodImage(imageId); }\n                else if (text.includes('Generate Variation')) { showVariationSubmenu(imageId); }\n                else if (text.includes('Edit with AI'))       { showManualPromptUI(imageId, 'edit'); }\n                else if (text.includes('New from Ref'))       { showManualPromptUI(imageId, 'reference'); }\n                else if (text.includes('Rotate'))            { rotateMoodImage(imageId); }\n                else if (text.includes('Duplicate'))         { duplicateMoodImage(imageId); }\n                else if (text.includes('Delete'))            { deleteMoodImage(imageId); }\n            } catch (err) {\n                console.error('[CtxMenu] Action failed:', err);\n                try { showNotification('Action failed: ' + (err && err.message ? err.message : String(err))); } catch (_) {}\n            }"

if needle_old in s:
    s = s.replace(needle_old, needle_new)
else:
    # Already patched or slightly different; don't fail
    pass

# 2) Replace downloadMoodImage implementation to use fetch->blob for Electron/iframe compatibility
pat = re.compile(r"function downloadMoodImage\(imageId\) \{[\s\S]*?\n\}\n\nasync function duplicateMoodImage", re.M)
m = pat.search(s)
if not m:
    raise SystemExit("downloadMoodImage block not found")

new_block = """function downloadMoodImage(imageId) {
    const ids = moodBoardState.selectedImages.size > 0 ? [...moodBoardState.selectedImages] : [imageId];
    ids.forEach(async (id) => {
        const imgData = state.moodBoardImages.find(i => i.id === id);
        if (!imgData || !imgData.url) return;
        try {
            const resp = await fetch(imgData.url, { cache: 'no-store' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objUrl;
            a.download = `media-wall-${id.substring(0, 8)}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
        } catch (err) {
            console.error('[Download] Failed', err);
            try { showNotification('Download failed'); } catch (_) {}
        }
    });
    try { showNotification(`Downloaded ${ids.length} image${ids.length > 1 ? 's' : ''}`); } catch (_) {}
    const menu = document.getElementById('mwContextMenu');
    if (menu) menu.style.display = 'none';
}

async function duplicateMoodImage"""

s = s[:m.start()] + new_block + s[m.end():]

with open(path, "w", encoding="utf-8") as f:
    f.write(s)

print("patched planning_mood.js")
