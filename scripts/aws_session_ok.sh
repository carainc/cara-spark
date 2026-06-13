#!/usr/bin/env bash
# aws_session_ok — assert the cara-prod SSO session is alive BEFORE any deploy / aws mutate.
# Hard rule (runbook §DEPLOY): run this and require exit 0 before `terraform apply` or any aws write.
#   exit 0 → session alive, safe to proceed
#   exit 1 → dead/expired → run:  aws sso login --profile cara-prod   (one browser approval)
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-cara-prod}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
if ident=$(aws sts get-caller-identity --output text --query 'Arn' 2>/dev/null); then
  echo "aws_session_ok: OK  profile=$AWS_PROFILE region=$AWS_REGION  $ident"
  exit 0
fi
echo "aws_session_ok: SESSION DEAD — run:  aws sso login --profile $AWS_PROFILE" >&2
exit 1
