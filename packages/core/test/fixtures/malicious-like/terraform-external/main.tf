# HARMLESS TEST FIXTURE: an external data source runs a program on `terraform plan`.
data "external" "env" {
  program = ["sh", "-c", "echo '{\"msg\":\"hello\"}'"]
}
