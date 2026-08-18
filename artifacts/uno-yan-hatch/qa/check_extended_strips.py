from pathlib import Path
from PIL import Image

names = "idle-sit walk-slow-left walk-slow-right walk-slow-up walk-slow-down search-seat search-current-window search-desktop-icon seat-on-item look-file ask-confirm eat-normal".split()
def key_residue(pixel):
    r, g, b, a = pixel
    return a and ((b >= 240 and g >= 200 and r <= 20) or (a < 128 and r <= 16 and g >= 128 and b >= 150 and b > r and g > r))
for name in names:
    image = Image.open(Path("public/pet/extended-animations") / f"{name}.png").convert("RGBA")
    assert image.size == (768, 208), (name, image.size)
    assert not any(key_residue(pixel) for pixel in image.getdata()), name
print("extended strips OK")
