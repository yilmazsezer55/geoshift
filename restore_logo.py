from PIL import Image
import os

def crop_to_rounded_square(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    width, height = img.size
    
    # The logo has a white rounded square (255, 255, 255).
    # Outside that square is transparent (0, 0, 0, 0).
    # We want to find the bounding box of the WHITE square.
    
    # Get bounding box of anything not transparent
    bbox = img.getbbox()
    if bbox:
        # Crop it
        img = img.crop(bbox)
        
        # Make it a perfect square if it's not
        w, h = img.size
        # The user's image is likely meant to be square.
        # We'll just save it as is if it found the edges correctly.
        img.save(output_path)
        print(f"Restored and cropped {input_path} to {output_path}. New size: {img.size}")
    else:
        print("Could not find any content in the image.")

if __name__ == "__main__":
    crop_to_rounded_square("d:/projeler/konum-degistirme/app-icon.png", "d:/projeler/konum-degistirme/src/assets/logo.png")
