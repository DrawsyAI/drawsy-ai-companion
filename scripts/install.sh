#!/bin/sh

set -eu

repository="DrawsyAI/drawsy-ai-companion"
release_api="https://api.github.com/repos/${repository}/releases/latest"
operating_system="$(uname -s)"
architecture="$(uname -m)"
kind=""
asset=""

fail() {
  printf 'Drawsy Companion installer: %s\n' "$1" >&2
  exit 1
}

case "${operating_system}:${architecture}" in
  Darwin:arm64|Darwin:aarch64)
    kind="macos"
    ;;
  Darwin:x86_64)
    fail "The current macOS release supports Apple Silicon only. Use the download page for release details."
    ;;
  Linux:x86_64|Linux:amd64)
    kind="linux"
    ;;
  *)
    fail "This installer supports Apple Silicon macOS and x64 Linux. Download options: https://github.com/${repository}/releases/latest"
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  fail "curl is required. Install it, then run this command again."
fi

if [ "$kind" = "linux" ] && [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  fail "Open a terminal in your Linux desktop session, then run this command again."
fi

release_json="$(curl --fail --silent --show-error --location \
  --header 'Accept: application/vnd.github+json' \
  --header 'User-Agent: Drawsy-Companion-Installer' \
  "$release_api")" || fail "Could not read the latest GitHub release."

tag="$(printf '%s\n' "$release_json" | sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | sed -n '1p')"
case "$tag" in
  v[0-9]*.[0-9]*.[0-9]*) version="${tag#v}" ;;
  *) fail "GitHub did not return a stable Companion release." ;;
esac
case "$version" in
  *[!0-9.]*|*..*|.*|*.) fail "The latest release version has an unexpected format." ;;
esac

if [ "$kind" = "macos" ]; then
  asset="Drawsy.Companion-${version}-arm64.dmg"
  if ! command -v hdiutil >/dev/null 2>&1 || ! command -v ditto >/dev/null 2>&1; then
    fail "This Mac is missing a built-in installer tool. Download the DMG from GitHub instead."
  fi
else
  asset="Drawsy.Companion-${version}.AppImage"
  if ! command -v sha256sum >/dev/null 2>&1; then
    fail "sha256sum is required to verify the download."
  fi
fi

temporary_directory="${TMPDIR:-/tmp}/drawsy-companion-install.$$"
mounted=0
staged_app=""
mount_point=""
cleanup() {
  if [ "$mounted" -eq 1 ]; then
    hdiutil detach "$mount_point" -quiet >/dev/null 2>&1 || true
  fi
  if [ -n "$staged_app" ] && [ -e "$staged_app" ]; then
    rm -rf "$staged_app"
  fi
  rm -rf "$temporary_directory"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
(umask 077 && mkdir "$temporary_directory") || fail "Could not create a temporary install folder."

printf 'Downloading Drawsy Companion %s...\n' "$version"
download_url="https://github.com/${repository}/releases/download/${tag}/${asset}"
curl --fail --silent --show-error --location "$download_url" \
  --output "$temporary_directory/$asset" || fail "The latest release does not contain $asset."
curl --fail --silent --show-error --location \
  "https://github.com/${repository}/releases/download/${tag}/SHA256SUMS" \
  --output "$temporary_directory/SHA256SUMS" || fail "Could not download the release checksum."

expected_hash="$(awk -v asset="$asset" '$2 == asset { print $1; exit }' "$temporary_directory/SHA256SUMS")"
if [ -z "$expected_hash" ]; then
  fail "The release checksum does not include $asset."
fi
if [ "$kind" = "macos" ]; then
  actual_hash="$(shasum -a 256 "$temporary_directory/$asset" | awk '{ print $1 }')"
else
  actual_hash="$(sha256sum "$temporary_directory/$asset" | awk '{ print $1 }')"
fi
if [ "$actual_hash" != "$expected_hash" ]; then
  fail "The downloaded file did not match GitHub's checksum."
fi
printf 'Download checked. Installing for your account...\n'

if [ "$kind" = "macos" ]; then
  applications_directory="$HOME/Applications"
  destination="$applications_directory/Drawsy Companion.app"
  mount_point="$temporary_directory/mounted"
  mkdir -p "$applications_directory" "$mount_point"
  hdiutil attach "$temporary_directory/$asset" -nobrowse -quiet -mountpoint "$mount_point" \
    || fail "Could not open the downloaded disk image."
  mounted=1
  app_source="$(find "$mount_point" -type d -name '*.app' -print | sed -n '1p')"
  if [ -z "$app_source" ]; then
    fail "The disk image did not contain the Companion app."
  fi
  staged_app="$applications_directory/.Drawsy Companion.installing.$$"
  ditto "$app_source" "$staged_app" || fail "Could not prepare the app."
  backup=""
  if [ -e "$destination" ]; then
    backup="${destination}.previous-$(date +%Y%m%d%H%M%S)"
    mv "$destination" "$backup" || fail "Could not safely replace the existing app."
  fi
  if ! mv "$staged_app" "$destination"; then
    if [ -n "$backup" ] && [ -e "$backup" ]; then
      mv "$backup" "$destination" || true
    fi
    fail "Could not place the app in your Applications folder."
  fi
  staged_app=""
  hdiutil detach "$mount_point" -quiet >/dev/null || fail "The app installed, but the disk image could not be closed."
  mounted=0
  open -a "$destination" || fail "The app installed, but macOS could not open it."
  printf 'Drawsy Companion %s is installed in ~/Applications and opening now.\n' "$version"
  printf 'Next, go to https://drawsyai.com in your browser.\n'
else
  data_directory="${XDG_DATA_HOME:-$HOME/.local/share}"
  install_directory="$data_directory/drawsy-companion"
  applications_directory="$data_directory/applications"
  app_image="$install_directory/Drawsy.Companion.AppImage"
  staged_image="$install_directory/.Drawsy.Companion.AppImage.$$"
  desktop_file="$applications_directory/drawsy-companion.desktop"
  mkdir -p "$install_directory" "$applications_directory"
  cp "$temporary_directory/$asset" "$staged_image" || fail "Could not prepare the AppImage."
  chmod 700 "$staged_image"
  mv -f "$staged_image" "$app_image" || fail "Could not install the AppImage."
  desktop_exec="$(printf '%s' "$app_image" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')"
  {
    printf '[Desktop Entry]\n'
    printf 'Type=Application\n'
    printf 'Name=Drawsy Companion\n'
    printf 'Exec=env APPIMAGE_EXTRACT_AND_RUN=1 "%s"\n' "$desktop_exec"
    printf 'Icon=applications-development\n'
    printf 'Terminal=false\n'
    printf 'Categories=Development;\n'
  } > "$desktop_file"
  chmod 600 "$desktop_file"
  nohup env APPIMAGE_EXTRACT_AND_RUN=1 "$app_image" >/dev/null 2>&1 </dev/null &
  printf 'Drawsy Companion %s is installed for your account and opening now.\n' "$version"
  printf 'Next, go to https://drawsyai.com in your browser.\n'
fi
