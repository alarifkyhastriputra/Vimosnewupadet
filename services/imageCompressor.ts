export const compressImage = (
  fileOrBase64: File | string,
  maxWidth: number = 1080,
  maxHeight: number = 1080,
  quality: number = 0.82
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const processImage = () => {
      let width = img.width || 800;
      let height = img.height || 800;

      if (width > maxWidth || height > maxHeight) {
        if (width / height > maxWidth / maxHeight) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(typeof fileOrBase64 === 'string' ? fileOrBase64 : '');
        return;
      }

      // Smooth resizing
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };

    img.onload = processImage;
    img.onerror = () => {
      if (typeof fileOrBase64 === 'string') {
        resolve(fileOrBase64);
      } else {
        reject(new Error('Failed to load image for compression'));
      }
    };

    if (typeof fileOrBase64 === 'string') {
      img.src = fileOrBase64;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          img.src = e.target.result as string;
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(fileOrBase64);
    }
  });
};
