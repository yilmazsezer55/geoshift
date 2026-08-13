from PIL import Image
import os

def crop_image(input_path, output_path):
    img = Image.open(input_path)
    # If the image is color and has white background, convert to RGBA to detect non-white
    img = img.convert("RGBA")
    
    # Simple bounding box for non-transparent/non-white pixels
    # (Since it's white on white, we look for anything not (255, 255, 255, 255))
    data = img.getdata()
    
    # We want to find the bounds of the actual logo
    # The current logo has a white rounded square, but even that has padding.
    # We should crop to the rounded square itself, not just the inner logo.
    
    width, height = img.size
    left, top, right, bottom = width, height, 0, 0
    
    for y in range(height):
        for x in range(width):
            r, g, b, a = img.getpixel((x, y))
            # If not pure white
            if r < 252 or g < 252 or b < 252:
                if x < left: left = x
                if y < top: top = y
                if x > right: right = x
                if y > bottom: bottom = y
                
    # Add a tiny bit of padding (2%)
    padding = int((right - left) * 0.02)
    left = max(0, left - padding)
    top = max(0, top - padding)
    right = min(width, right + padding)
    bottom = min(height, bottom + padding)
    
    cropped = img.crop((left, top, right, bottom))
    cropped.save(output_path)
    print(f"Cropped {input_path} to {output_path}. New size: {cropped.size}")

if __name__ == "__main__":
    crop_image("d:/projeler/konum-degistirme/src/assets/logo.png", "d:/projeler/konum-degistirme/src/assets/logo_cropped.png")
