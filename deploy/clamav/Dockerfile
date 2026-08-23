FROM clamav/clamav:1.4.6-debian13-slim

# The application accepts videos up to 2 GiB. ClamD rejects INSTREAM data above
# StreamMaxLength unless the daemon limits are raised to the same operational boundary.
RUN sed -ri 's/^#?StreamMaxLength .*/StreamMaxLength 2200M/; s/^#?MaxFileSize .*/MaxFileSize 2200M/; s/^#?MaxScanSize .*/MaxScanSize 2200M/' /etc/clamav/clamd.conf
