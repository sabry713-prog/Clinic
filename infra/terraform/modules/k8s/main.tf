# Kubernetes RBAC and NetworkPolicy module
#
# Provisions:
#   - Namespace
#   - ServiceAccount for core workloads
#   - NetworkPolicies (default-deny + allow only necessary traffic)

resource "kubernetes_namespace" "app" {
  metadata {
    name = var.namespace
    labels = {
      "app.kubernetes.io/name" = "clinical-copilot"
      "environment"            = var.environment
    }
  }
}

resource "kubernetes_service_account" "core" {
  metadata {
    name      = "clinical-copilot-core"
    namespace = kubernetes_namespace.app.metadata[0].name
    labels = {
      "app.kubernetes.io/component" = "core"
    }
  }
}

# ── Default deny all ingress ──────────────────────────────────────────────────
resource "kubernetes_network_policy" "default_deny_ingress" {
  metadata {
    name      = "default-deny-ingress"
    namespace = kubernetes_namespace.app.metadata[0].name
  }
  spec {
    pod_selector {}
    policy_types = ["Ingress"]
  }
}

# ── Allow Ingress controller → core (port 4000) ───────────────────────────────
resource "kubernetes_network_policy" "allow_ingress_to_core" {
  metadata {
    name      = "allow-ingress-to-core"
    namespace = kubernetes_namespace.app.metadata[0].name
  }
  spec {
    pod_selector {
      match_labels = {
        "app.kubernetes.io/component" = "core"
      }
    }
    ingress {
      ports {
        port     = "4000"
        protocol = "TCP"
      }
      from {
        namespace_selector {
          match_labels = {
            "kubernetes.io/metadata.name" = "ingress-nginx"
          }
        }
      }
    }
    policy_types = ["Ingress"]
  }
}

# ── Allow core → narrative (port 5001) ───────────────────────────────────────
resource "kubernetes_network_policy" "allow_core_to_narrative" {
  metadata {
    name      = "allow-core-to-narrative"
    namespace = kubernetes_namespace.app.metadata[0].name
  }
  spec {
    pod_selector {
      match_labels = {
        "app.kubernetes.io/component" = "narrative"
      }
    }
    ingress {
      ports {
        port     = "5001"
        protocol = "TCP"
      }
      from {
        pod_selector {
          match_labels = {
            "app.kubernetes.io/component" = "core"
          }
        }
      }
    }
    policy_types = ["Ingress"]
  }
}

# ── Allow core → qa (port 5002) ───────────────────────────────────────────────
resource "kubernetes_network_policy" "allow_core_to_qa" {
  metadata {
    name      = "allow-core-to-qa"
    namespace = kubernetes_namespace.app.metadata[0].name
  }
  spec {
    pod_selector {
      match_labels = {
        "app.kubernetes.io/component" = "qa"
      }
    }
    ingress {
      ports {
        port     = "5002"
        protocol = "TCP"
      }
      from {
        pod_selector {
          match_labels = {
            "app.kubernetes.io/component" = "core"
          }
        }
      }
    }
    policy_types = ["Ingress"]
  }
}

# ── Allow Prometheus → all pods on /metrics (port varies) ────────────────────
resource "kubernetes_network_policy" "allow_prometheus_scrape" {
  metadata {
    name      = "allow-prometheus-scrape"
    namespace = kubernetes_namespace.app.metadata[0].name
  }
  spec {
    pod_selector {}
    ingress {
      from {
        namespace_selector {
          match_labels = {
            "kubernetes.io/metadata.name" = var.prometheus_namespace
          }
        }
      }
    }
    policy_types = ["Ingress"]
  }
}

output "namespace" {
  value = kubernetes_namespace.app.metadata[0].name
}
