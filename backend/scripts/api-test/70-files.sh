# Private attachments (CONTRACT §11, BRD §6.12; AC08, AC23, AC24).
FILES_DIR="$(mktemp -d)"; command -v cygpath >/dev/null && FILES_DIR="$(cygpath -m "$FILES_DIR")"
node -e "
const fs=require('fs'),d=process.argv[1];
const jpg=Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,0xff,0xd9]);
fs.writeFileSync(d+'/photo.jpg',jpg);
// Exif APP1 with a GPS IFD pointer (tag 0x8825), little-endian
const tiff=Buffer.from([0x49,0x49,0x2a,0,8,0,0,0, 1,0, 0x25,0x88,4,0,1,0,0,0,26,0,0,0, 0,0,0,0]);
const app1=Buffer.concat([Buffer.from('Exif\0\0','latin1'),tiff]);
const seg=Buffer.concat([Buffer.from([0xff,0xe1,(app1.length+2)>>8,(app1.length+2)&255]),app1]);
fs.writeFileSync(d+'/gps.jpg',Buffer.concat([Buffer.from([0xff,0xd8]),seg,Buffer.from([0xff,0xd9])]));
fs.writeFileSync(d+'/quote.pdf','%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
fs.writeFileSync(d+'/script.pdf','%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF\n');
fs.writeFileSync(d+'/real.png',Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]));
fs.writeFileSync(d+'/notes.txt','hello');
const big=Buffer.alloc(21*1024*1024,32); Buffer.from('%PDF-1.4\n').copy(big); fs.writeFileSync(d+'/big.pdf',big);
" "$FILES_DIR"

# upload EXPECTED FILE;type=MIME [extra -F args...]
upload() {
  local expect="$1" spec="$2"; shift 2
  local args=(-s -o "$OUT" -w '%{http_code}' -X POST "$API/attachments" -H "authorization: Bearer $TOKEN" -H "idempotency-key: $(uuid)" -F "file=@$FILES_DIR/$spec")
  for f in "$@"; do args+=(-F "$f"); done
  local status; status="$(curl "${args[@]}")"
  if [[ ",$expect," == *",$status,"* ]]; then PASS=$((PASS+1)); printf '  \033[32m✓\033[0m UPLOAD %-70s %s\n' "${spec:0:70}" "$status"
  else FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m UPLOAD %-70s %s (expected %s)\n' "${spec:0:70}" "$status" "$expect"; head -c 600 "$OUT"; echo; fi
}

TOKEN="$OWNER_TOKEN"
call POST /projects 201 '{"name":"Files test house","type":"renovation","country_code":"IE","currency":"EUR","unit_system":"metric","storeys":1,"finish_tier":"standard","private_address":"1 Secret Lane"}'
FPROJ="$(js 'd.data.id')"
call GET "/projects/$FPROJ/phases" 200; FPHASE="$(js 'd.data[0].id')"

upload 201 'photo.jpg;type=image/jpeg' attachment_type=progress "project_id=$FPROJ" target_type=phase "target_id=$FPHASE"
PHOTO="$(js 'd.data.id')"; check 'd.data.mime==="image/jpeg"&&d.data.scan_status==="clean"&&Boolean(d.data.project_id)' 'photo stored, linked to the phase'
upload 201 'quote.pdf;type=application/pdf' attachment_type=quote "project_id=$FPROJ"; PDF="$(js 'd.data.id')"
upload 201 'real.png;type=application/octet-stream' attachment_type=document; check 'd.data.mime==="image/png"' 'the bytes decide the type, not the client'
upload 422 'real.png;type=image/jpeg' attachment_type=photo; check 'd.error.code==="FILE_REJECTED"' 'AC24 forged MIME refused'
upload 422 'script.pdf;type=application/pdf' attachment_type=quote; check 'd.error.code==="FILE_REJECTED"' 'AC24 PDF with JavaScript refused'
upload 422 'gps.jpg;type=image/jpeg' attachment_type=photo; check 'd.error.code==="FILE_REJECTED"' 'a photo still carrying GPS is refused'
upload 415 'notes.txt;type=text/plain' attachment_type=document; check 'd.error.code==="UNSUPPORTED_FILE"' 'unsupported type refused'
upload 413 'big.pdf;type=application/pdf' attachment_type=document; check 'd.error.code==="FILE_TOO_LARGE"' 'AC24 over 20 MB refused'
upload 400 'photo.jpg;type=image/jpeg' attachment_type=selfie

call GET "/attachments?target_type=phase&target_id=$FPHASE" 200; check 'd.data.length===1&&d.data[0].id==="'"$PHOTO"'"' 'files listed for the phase'
call POST "/attachments/$PDF/links" 200 "{\"target_type\":\"phase\",\"target_id\":\"$FPHASE\"}"
call GET "/attachments/$PHOTO/download-url" 200; DL="$(js 'd.data.url')"
check 'd.data.url.includes("/api/v1/files/")&&Date.parse(d.data.expires_at)-Date.now()<=600e3+5000' 'AC23 a 10-minute signed link on our own worker'
s="$(curl -s -o "$OUT.bin" -w '%{http_code}' "$DL")"
if [ "$s" = 200 ] && cmp -s "$OUT.bin" "$FILES_DIR/photo.jpg"; then PASS=$((PASS+1)); echo "    ✓ the signed link returns the original bytes (decrypted)"; else FAIL=$((FAIL+1)); echo "    ✗ signed download ($s)"; fi
s="$(curl -s -o /dev/null -w '%{http_code}' "${DL%%sig=*}sig=$(printf '0%.0s' {1..64})")"
[ "$s" = 403 ] && { PASS=$((PASS+1)); echo "    ✓ AC23 a forged signature fails"; } || { FAIL=$((FAIL+1)); echo "    ✗ forged signature gave $s"; }
s="$(curl -s -o /dev/null -w '%{http_code}' "$API/files/$PHOTO")"
[ "$s" = 403 ] && { PASS=$((PASS+1)); echo "    ✓ AC23 an unsigned link fails"; } || { FAIL=$((FAIL+1)); echo "    ✗ unsigned link gave $s"; }
s="$(curl -s -o /dev/null -w '%{http_code}' "$API/files/$PHOTO?exp=1000&sig=$(printf 'a%.0s' {1..64})")"
[ "$s" = 403 ] && { PASS=$((PASS+1)); echo "    ✓ AC23 an expired link fails"; } || { FAIL=$((FAIL+1)); echo "    ✗ expired link gave $s"; }

echo "  isolation (AC08)"
TOKEN="$OUTSIDER_TOKEN"
call GET "/attachments/$PHOTO/download-url" 404
call DELETE "/attachments/$PHOTO" 404
call POST "/attachments/$PHOTO/links" 404 "{\"target_type\":\"phase\",\"target_id\":\"$FPHASE\"}"
upload 404 'photo.jpg;type=image/jpeg' attachment_type=progress target_type=phase "target_id=$FPHASE"; check 'd.error.code==="NOT_FOUND"' 'AC24 a cross-owner link fails'
call GET "/attachments?target_type=phase&target_id=$FPHASE" 404
TOKEN="$UNPAID_TOKEN"
upload 403 'photo.jpg;type=image/jpeg' attachment_type=photo

echo "  evidence lock"
TOKEN="$OWNER_TOKEN"
call DELETE "/attachments/$PDF" 200; check 'd.data.deleted===true' 'an unlinked-to-posted file can be deleted'
call GET "/attachments/$PDF/download-url" 404
rm -rf "$FILES_DIR" "$OUT.bin"
