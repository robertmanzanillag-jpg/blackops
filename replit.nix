{ pkgs }: {
  deps = [
    pkgs.yt-dlp
    pkgs.curl
    pkgs.ffmpeg
    pkgs.deno
    pkgs.nodejs_20
    pkgs.chromium
    pkgs.imagemagick
    pkgs.tesseract
  ];
}
