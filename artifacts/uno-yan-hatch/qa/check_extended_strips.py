from pathlib import Path
from PIL import Image

names = "idle-sit walk-slow-left walk-slow-right walk-slow-up walk-slow-down search-seat search-current-window search-desktop-icon seat-on-item look-file ask-confirm eat-normal".split()
for name in names:
    image = Image.open(Path("public/pet/extended-animations") / f"{name}.png").convert("RGBA")
    assert image.size == (768, 208), (name, image.size)
    assert not any(pixel[:3] == (0, 255, 255) and pixel[3] for pixel in image.getdata()), name
print("extended strips OK")
