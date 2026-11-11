.DEFAULT_GOAL := check

NODE_IMAGE := node:$(patsubst v%,%,$(shell cat .nvmrc))
SHELLCHECK_IMAGE := koalaman/shellcheck:v0.11.0

export NODE_IMAGE SHELLCHECK_IMAGE
export CHECK_TIMEOUT_SECONDS CHECK_MEMORY CHECK_SCRATCH_SIZE CHECK_WORK_SIZE CHECK_TMP_SIZE

.PHONY: check

check:
	@./tests/container/check-stock
