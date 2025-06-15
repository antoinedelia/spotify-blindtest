#!/usr/bin/env python3
import os

import aws_cdk as cdk

from frontend.frontend_acm_stack import FrontendAcmStack
from frontend.frontend_stack import FrontendStack


app_name = "SpotifyBlindtest"
app = cdk.App()

frontend_acm_stack = FrontendAcmStack(
    app,
    f"{app_name}-FrontendAcmStack",
    domain_name="antoinedelia.fr",
    subdomain="blindtest",
    env=cdk.Environment(account="646082475080", region="us-east-1"),
    cross_region_references=True,
)
FrontendStack(
    app,
    f"{app_name}-FrontendStack",
    domain_name="antoinedelia.fr",
    subdomain="blindtest",
    certificate=frontend_acm_stack.certificate,
    env=cdk.Environment(account="646082475080", region="eu-west-1"),
    cross_region_references=True,
)

app.synth()
