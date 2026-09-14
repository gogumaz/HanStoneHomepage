#!/usr/bin/env bash

set -euo pipefail

REGION="ap-northeast-2"
STACK_NAME="hanstone-production-media"
CONFIRM=""

usage() {
  cat <<'EOF'
Usage:
  ./deploy/provision-aws-object-storage.sh [options]

Options:
  --region REGION       AWS region (default: ap-northeast-2)
  --stack-name NAME     CloudFormation stack name
  --confirm PHRASE      Required phrase: CREATE_HANSTONE_STORAGE
  -h, --help            Show this help

The script creates billable AWS resources. It never creates or prints an access key.
Run it from an authenticated AWS CloudShell or AWS CLI session.
EOF
}

require_value() {
  if [[ -z "${2:-}" ]]; then
    printf 'Missing value for %s\n' "$1" >&2
    exit 2
  fi
}

while (($# > 0)); do
  case "$1" in
    --region)
      require_value "$1" "${2:-}"
      REGION="$2"
      shift 2
      ;;
    --stack-name)
      require_value "$1" "${2:-}"
      STACK_NAME="$2"
      shift 2
      ;;
    --confirm)
      require_value "$1" "${2:-}"
      CONFIRM="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ "$CONFIRM" != "CREATE_HANSTONE_STORAGE" ]]; then
  printf 'Refusing to create AWS resources without --confirm CREATE_HANSTONE_STORAGE\n' >&2
  exit 2
fi
if ! command -v aws >/dev/null 2>&1; then
  printf 'AWS CLI is required. AWS CloudShell includes it by default.\n' >&2
  exit 1
fi
if [[ ! "$REGION" =~ ^[a-z]{2}(-gov)?-[a-z]+-[0-9]+$ ]]; then
  printf 'Invalid AWS region: %s\n' "$REGION" >&2
  exit 2
fi
if [[ ! "$STACK_NAME" =~ ^[A-Za-z][A-Za-z0-9-]{0,127}$ ]]; then
  printf 'Invalid CloudFormation stack name: %s\n' "$STACK_NAME" >&2
  exit 2
fi

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
TEMPLATE_PATH="${SCRIPT_DIRECTORY}/aws-object-storage.yaml"
if [[ ! -f "$TEMPLATE_PATH" ]]; then
  printf 'Template is missing: %s\n' "$TEMPLATE_PATH" >&2
  exit 1
fi

aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_PATH" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags Application=HanStone Environment=production

aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
  --output table

printf '%s\n' \
  'Stack deployed. Wait 15 minutes for first-time versioning propagation before the application preflight.' \
  'Create exactly one access key for the output RuntimeUserName and store it only in the root-owned server environment file.'
