"""
strip_debug.py — Removes debug code from index.html for production.

Replaces /* DBG_START */ ... /* DBG_END */ blocks with empty /* DBG_START *//* DBG_END */
shells so add_debug.py can re-inject the infrastructure later if needed.

Run: python3 strip_debug.py  (next to index.html)
"""
import re

with open('index.html', 'r') as f:
    content = f.read()

original_len = len(content)

# Replace content between markers with empty shells (keeps markers as placeholders)
content = re.sub(
    r'/\* DBG_START \*/.*?/\* DBG_END \*/',
    '/* DBG_START *//* DBG_END */',
    content,
    flags=re.DOTALL
)

# Clean up consecutive empty shells on same line into one
content = re.sub(r'(/\* DBG_START \*/\/\* DBG_END \*/\s*)+', '/* DBG_START *//* DBG_END */\n', content)

# Clean up excess blank lines
content = re.sub(r'\n{3,}', '\n\n', content)

final_len = len(content)
removed = original_len - final_len

with open('index.html', 'w') as f:
    f.write(content)

print(f"Done. Removed {removed:,} bytes ({removed/original_len*100:.1f}%)")
print(f"Empty marker shells remaining: {content.count('/* DBG_START *//* DBG_END */')}")
print(f"Run add_debug.py to restore debug capability.")
