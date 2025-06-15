from aws_cdk import Stack
from aws_cdk import aws_certificatemanager as acm
from aws_cdk import aws_route53 as route53
from constructs import Construct


class FrontendAcmStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, domain_name: str, subdomain: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        full_domain = f"{subdomain}.{domain_name}"

        # Get the existing hosted zone
        zone = route53.HostedZone.from_lookup(self, "HostedZone", domain_name=domain_name)

        self.certificate = acm.Certificate(
            self, "Certificate", domain_name=full_domain, validation=acm.CertificateValidation.from_dns(zone)
        )