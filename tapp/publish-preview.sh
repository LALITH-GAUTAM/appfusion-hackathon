#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: bash tapp/publish-preview.sh <tapp-ios-checkout> <committed-revision>" >&2
    exit 2
fi

ios_repo=$1
revision=$(git -C "$ios_repo" rev-parse --verify "$2^{commit}")
short_revision=${revision:0:12}
source_repo=adamsjack711-ux/tapp-ios
release_repo=LALITH-GAUTAM/appfusion-hackathon
release_tag=tapp-appfusion-preview
source_ref=refs/heads/appfusion-preview
asset="Tapp-iOS-Simulator-$short_revision.zip"
release_url="https://github.com/$release_repo/releases/download/$release_tag"
source_url="https://github.com/$source_repo/tree/$revision"

if [[ $(git -C "$ios_repo" remote get-url --push origin) != "https://github.com/$source_repo.git" ]]; then
    echo "Select the Tapp iOS checkout with its GitHub source repository as origin." >&2
    exit 2
fi

release_body=$(gh release view "$release_tag" --repo "$release_repo" --json body --jq .body)
if [[ "$release_body" == *"<!-- tapp-ios-commit: $revision -->"* ]]; then
    echo "Tapp $short_revision is already the current AppFusion preview."
    exit 0
fi

# Only publish descendants of the current integrated preview.
current_source=$(gh api "repos/$source_repo/branches/appfusion-preview" --jq .commit.sha)
if ! git -C "$ios_repo" merge-base --is-ancestor "$current_source" "$revision"; then
    echo "The selected revision must include the published iOS integration baseline." >&2
    exit 2
fi

stage=$(mktemp -d "${TMPDIR:-/tmp}/tapp-preview.XXXXXX")
trap 'git -C "$ios_repo" worktree remove "$stage/source" >/dev/null 2>&1 || true; rm -rf -- "$stage"' EXIT
git -C "$ios_repo" worktree add --detach "$stage/source" "$revision"

(
    cd "$stage/source"
    xcodebuild build -quiet \
        -project Tapp.xcodeproj -scheme Tapp -configuration Release \
        -destination 'generic/platform=iOS Simulator' -derivedDataPath "$stage/build" \
        -onlyUsePackageVersionsFromResolvedFile CODE_SIGNING_ALLOWED=NO
)

package="$stage/package"
product="$stage/build/Build/Products/Release-iphonesimulator/Tapp.app"
test -x "$product/Tapp"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$product/Info.plist")" = com.jackadamslovell.Tapp
mkdir -p "$package/Licenses/RorkDevice"
ditto "$product" "$package/Tapp.app"
cp "$stage/source/DeveloperTools/rork-device/"{LICENSE,THIRD_PARTY_NOTICES.md} "$package/Licenses/RorkDevice/"
ditto "$stage/source/DeveloperTools/rork-device/ThirdPartyLicenses" "$package/Licenses/RorkDevice/ThirdPartyLicenses"
for dataset in ConnectorArtworkNotices ConnectorLogosLicense ConnectorSimpleIconsLicense LucideLicense; do
    mkdir -p "$package/Licenses/$dataset"
    cp "$stage/source/Tapp/Assets.xcassets/$dataset.dataset/"*.txt "$package/Licenses/$dataset/"
done
for checkout in "$stage/build/SourcePackages/checkouts/"*; do
    for license in "$checkout"/LICENSE* "$checkout"/NOTICE*; do
        [[ -f "$license" ]] || continue
        mkdir -p "$package/Licenses/${checkout##*/}"
        cp "$license" "$package/Licenses/${checkout##*/}/"
    done
done

cat > "$package/README.md" <<EOF
# Tapp AppFusion simulator preview

Source commit: $revision

Boot one iPhone simulator in Xcode and run these commands from this folder.

\`\`\`sh
xcrun simctl install booted ./Tapp.app
xcrun simctl launch booted com.jackadamslovell.Tapp
\`\`\`

For live AI, enter your privately supplied code in Settings → Account and tap Connect Tapp.
EOF

ditto -c -k --norsrc "$package" "$stage/$asset"
unzip -tq "$stage/$asset"
git -C "$ios_repo" push origin "$revision:$source_ref"

if ! gh release view "$release_tag" --repo "$release_repo" --json assets --jq '.assets[].name' |
    grep -Fx "$asset" >/dev/null; then
    gh release upload "$release_tag" --repo "$release_repo" "$stage/$asset"
fi

mkdir "$stage/downloaded"
gh release download "$release_tag" --repo "$release_repo" --pattern "$asset" --dir "$stage/downloaded"
unzip -tq "$stage/downloaded/$asset"
unzip -p "$stage/downloaded/$asset" README.md | grep -Fx "Source commit: $revision" >/dev/null

if [[ $(gh api "repos/$source_repo/branches/appfusion-preview" --jq .commit.sha) != "$revision" ]]; then
    echo "A newer iOS revision was pushed while this build was publishing." >&2
    exit 1
fi

# Refresh only the current download block and retain installation instructions.
{
    printf '<!-- tapp-ios-commit: %s -->\n' "$revision"
    printf '**Current build:** [Download Tapp for iOS Simulator](%s/%s) · [Matching iOS source](%s)\n' "$release_url" "$asset" "$source_url"
    printf '<!-- end current Tapp build -->\n\n'
    gh release view "$release_tag" --repo "$release_repo" --json body --jq .body |
        awk '/^<!-- tapp-ios-commit: / {skip=1} /^<!-- end current Tapp build -->/ {skip=0; next} !skip'
} > "$stage/release.md"
gh release edit "$release_tag" --repo "$release_repo" --notes-file "$stage/release.md"
