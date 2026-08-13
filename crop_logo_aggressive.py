from PIL import Image, ImageChops
import os

def aggressive_crop(input_path, output_path):
    img = Image.open(input_path).convert("RGBA")
    
    # Detect the logo part (non-white and non-transparent)
    # The current logo has a white background. Let's make white transparent first to find the logo.
    data = img.getdata()
    new_data = []
    for item in data:
        # If it's pure white or very close to white, make it transparent
        if item[0] > 250 and item[1] > 250 and item[2] > 250:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)
    
    img.putdata(new_data)
    
    # Get bounding box of the non-transparent area (the actual logo)
    bbox = img.getbbox()
    if bbox:
        # Crop to the logo itself
        img = img.crop(bbox)
        
        # Now we have the logo. To make it "large" like iMyFone, 
        # we should place it on a square canvas with very little padding.
        width, height = img.size
        # Make it a square
        new_size = max(width, height)
        # Add 5% padding
        canvas_size = int(new_size * 1.05)
        
        # Create a new transparent canvas
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (255, 255, 255, 0))
        
        # Paste logo in the center
        offset = ((canvas_size - width) // 2, (canvas_size - height) // 2)
        canvas.paste(img, offset, img)
        
        # Optional: If the user wants a background like iMyFone (often white or colored), 
        # we can add it. But transparent usually looks "bigger" because the logo 
        # goes right to the edge of the icon slot.
        
        canvas.save(output_path)
        print(f"Aggressively cropped {input_path} to {output_path}. New size: {canvas.size}")
    else:
        print("Could not find logo content.")

if __name__ == "__main__":
    aggressive_crop("d:/projeler/konum-degistirme/src/assets/logo.png", "d:/projeler/konum-degistirme/src/assets/logo_fullframe.png")
