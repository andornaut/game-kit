.DEFAULT_GOAL := check

export NODE_IMAGE SHELLCHECK_IMAGE
export CHECK_TIMEOUT_SECONDS CHECK_MEMORY CHECK_NOFILE CHECK_SCRATCH_SIZE CHECK_WORK_SIZE CHECK_TMP_SIZE

.PHONY: check lint test build

check:
	@./tests/container/check-stock

lint test build:
	@./tests/container/check-stock $@
