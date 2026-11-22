# Extract one normalized SHA-256 certificate fingerprint from keytool -list -v output.
/^[[:space:]]*Certificate fingerprints:/ {
  in_fingerprints = 1
  next
}

in_fingerprints && /^[[:space:]]*Signature algorithm name:/ {
  exit
}

in_fingerprints && /^[[:space:]]*SHA256[[:space:]]*:/ {
  fingerprint = $0
  sub(/^[[:space:]]*SHA256[[:space:]]*:[[:space:]]*/, "", fingerprint)
  gsub(/[^[:xdigit:]]/, "", fingerprint)
  if (length(fingerprint) != 64) {
    print "Invalid SHA-256 certificate fingerprint in keytool output." > "/dev/stderr"
    failed = 1
    exit 2
  }
  print tolower(fingerprint)
  found = 1
  exit
}

END {
  if (!found && !failed) {
    print "SHA-256 certificate fingerprint not found in keytool output." > "/dev/stderr"
    exit 1
  }
}
